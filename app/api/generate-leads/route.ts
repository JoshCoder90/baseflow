import { NextResponse } from "next/server"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import OpenAI from "openai"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  badRequest,
  INPUT_MAX,
  validateText,
  validateUuid,
} from "@/lib/api-input-validation"
import { dailyUsageLimitResponseIfExceeded } from "@/lib/daily-usage-limit"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import {
  consumeRateLimit,
  tryBeginScrapeForUser,
  endScrapeForUser,
  tooManyRequestsJson,
  RATE_LIMIT,
  SCRAPE_POLICY,
} from "@/lib/rate-limit-policy"
import {
  contactKeyForCampaignLead,
  insertOneCampaignLeadIfUnderCap,
  type LeadRowInput,
  SCRAPER_MAX_ROWS_PER_CAMPAIGN,
} from "@/lib/campaign-leads-insert"
import {
  buildAllSearchAreaStrings,
  buildPlacesKeywordVariants,
  expandLocationsWithAI,
  mergeSearchAreaStringLists,
} from "@/lib/lead-search-expansion"
import {
  countEmailLeadsForContext,
  countValidLeadsForContext,
} from "@/lib/lead-validity"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"
import {
  firstGuessableEmailForDomain,
  normalizeWebsiteUrl,
  scrapeEmailFromWebsite,
} from "@/lib/email-enrichment"
import { enrichEmail } from "@/lib/hunter-domain-enrich"
import { CAMPAIGN_NEARBY_OFFSET_DEG } from "@/lib/campaign-geo-expansion"
import {
  geocodeAddressToTarget,
  isNearbyPlaceInTargetRegion,
  reverseGeocodeToTarget,
} from "@/lib/location-targeting"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

if (!supabaseServiceKey) {
  throw new Error("SUPABASE_SERVICE_KEY missing from env")
}

const MAX_LEADS = SCRAPE_POLICY.maxLeadsPerScrape
const DEFAULT_LEAD_CAP = MAX_LEADS

/** Parse natural language search into niche + location for Google Places */
async function parseSearchQuery(query: string): Promise<{ niche: string; location: string }> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    // Fallback: simple heuristic - last part after "in" is location
    const match = query.match(/^(.+?)\s+in\s+(.+)$/i)
    if (match) {
      return { niche: match[1].trim(), location: match[2].trim() }
    }
    return { niche: query.trim(), location: "United States" }
  }
  const openai = new OpenAI({ apiKey: openaiKey })
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extract business type (niche) and location from the user's search query.
Examples:
- "Dental offices in New York" -> niche: "dental offices", location: "New York"
- "Roofing companies in Dallas" -> niche: "roofing companies", location: "Dallas"
- "Real estate agents in Miami" -> niche: "real estate agents", location: "Miami"
- "Gyms in Los Angeles" -> niche: "gyms", location: "Los Angeles"
- "Marketing agencies in Austin" -> niche: "marketing agencies", location: "Austin"
Return JSON: { "niche": "...", "location": "..." }
If no location is given, use "United States".`,
      },
      { role: "user", content: query },
    ],
    response_format: { type: "json_object" },
  })
  const text = res.choices[0]?.message?.content ?? "{}"
  const parsed = JSON.parse(text) as { niche?: string; location?: string }
  return {
    niche: parsed.niche?.trim() || query.trim(),
    location: parsed.location?.trim() || "United States",
  }
}
/** Nearby search radii (meters); expand 5 → 50km for coverage. */
const RADIUS_STEPS = [5000, 10000, 20000, 50000]
/** Nearby Search pagination: Google allows ~3 pages immediately; more with delay. Stop when no token or lead cap met. */
const MAX_PLACE_PAGES_PER_SEARCH = 60
const PAGE_TOKEN_DELAY_MS = 1000
/** Parallel Places + website email scrape: batch size; short delay between batches. */
const BATCH_SIZE = 10
const SCRAPER_CHUNK_DELAY_MS = 150
/** Campaign: stop when lead row cap met, or after this many Places rows (safety). */
const SMART_STOP_MAX_BUSINESSES_SCANNED = 4000

async function scraperDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}
/** Hard cap per lead (Place Details + email scrape) — skip lead if exceeded. */
const ENRICH_LEAD_TIMEOUT_MS = 8000

function domainFromWebsiteUrl(website: string | null): string | null {
  if (!website?.trim()) return null
  try {
    const u = new URL(normalizeWebsiteUrl(website))
    let h = u.hostname.toLowerCase().replace(/^www\./, "")
    if (!h.includes(".")) return null
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return null
    return h.length > 0 ? h : null
  } catch {
    return null
  }
}
const FETCH_TIMEOUT_MS = 20000
/** Absolute backstop for runaway pagination (beyond SMART_STOP_MAX_BUSINESSES_SCANNED). */
const MAX_RAW_BUSINESSES = 2500

const MAX_CONSECUTIVE_EMPTY_WAVES = 3

/** Cap geocode calls per run (primary + metro expansion + AI). */
const MAX_SEARCH_AREA_STRINGS = 52
const GEOCODE_BATCH_SIZE = 10
/** Cap Places keyword variants per run (niche + AI + fallbacks). */
const MAX_KEYWORD_VARIANTS = 24

/** Safe fetch with timeout - returns null on failure, never throws */
async function safeFetch(url: string, options: RequestInit = {}): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res || !res.ok) {
      console.log("Bad response, skipping:", res?.status, (url || "").slice(0, 60))
      return null
    }
    return res
  } catch (err) {
    console.log("Fetch failed, skipping:", (url || "").slice(0, 80), String(err))
    return null
  }
}

/** Safe JSON parse - returns null on failure. Pass Response | null from safeFetch. */
async function safeJson<T = unknown>(res: Response | null): Promise<T | null> {
  if (!res) return null
  try {
    return (await res.json()) as T
  } catch {
    console.log("JSON parse failed, skipping")
    return null
  }
}

async function updateProgress(
  supabase: SupabaseClient,
  audienceId: string,
  leadsCollected: number,
  status: string
) {
  await supabase
    .from("audiences")
    .update({ leads_collected: leadsCollected, status })
    .eq("id", audienceId)
}

/** Keep oldest `cap` rows; delete extras (by id) after enrichment. */
async function trimLeadRowsToCap(
  supabase: SupabaseClient,
  ctx: GenerationContext,
  cap: number
): Promise<void> {
  const q = supabase.from("leads").select("id").order("id", { ascending: true })
  if (ctx.mode === "campaign") {
    q.eq("campaign_id", ctx.campaignId)
  } else {
    q.eq("audience_id", ctx.audienceId)
  }
  const { data, error } = await q
  if (error || !data || data.length <= cap) return
  const excess = data.slice(cap)
  for (const r of excess) {
    await supabase.from("leads").delete().eq("id", r.id as string)
  }
  if (excess.length > 0) {
    console.log(`[generate-leads] trimmed ${excess.length} excess rows to cap ${cap}`)
  }
}

type GenerationContext =
  | { mode: "audience"; audienceId: string; userId: string; niche: string; location: string; leadCap: number }
  | {
      mode: "campaign"
      campaignId: string
      userId: string
      searchQuery: string
      niche: string
      location: string
      leadCap: number
      /** From campaigns.location_lat/lng when set at create (or prior scrape). */
      storedCampaignCoords?: { lat: number; lng: number } | null
    }

async function getLeadCount(
  supabase: SupabaseClient,
  ctx: GenerationContext
): Promise<number> {
  const q = supabase.from("leads").select("*", { count: "exact", head: true })
  if (ctx.mode === "campaign") {
    q.eq("campaign_id", ctx.campaignId)
  } else {
    q.eq("audience_id", ctx.audienceId)
  }
  const { count } = await q
  return count ?? 0
}

function rowHasUsableEmail(email: unknown): boolean {
  return typeof email === "string" && email.trim().length > 0
}

/** Leads we can still enrich via Places (have place_id) but lack email — email-only pipeline. */
function rowNeedsContactFetch(row: { email?: unknown; place_id?: unknown }): boolean {
  const pid = row.place_id
  if (typeof pid !== "string" || !pid.trim()) return false
  return !rowHasUsableEmail(row.email)
}

async function countCampaignLeadsNeedingContactFetch(
  supabase: SupabaseClient,
  campaignId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, email, place_id")
    .eq("campaign_id", campaignId)
  if (error || !data) return 0
  return data.filter((r) => rowNeedsContactFetch(r)).length
}

type GenLeadCtx =
  | { mode: "campaign"; campaignId: string }
  | { mode: "audience"; audienceId: string }

/**
 * After scraping/contact fetch: Hunter domain-search fallback only until email target is met.
 * Skips entirely without HUNTER_IO_API_KEY. Does not replace scraping.
 */
async function runHunterFallbackToEmailTarget(
  supabase: SupabaseClient,
  genCtx: GenLeadCtx,
  TARGET: number,
  audienceIdForProgress?: string,
  /** If provided, run before each batch; return false to stop (e.g. campaign deleted). */
  batchGuard?: () => Promise<boolean>
): Promise<number> {
  let emailsFound = await countEmailLeadsForContext(supabase, genCtx)

  if (!process.env.HUNTER_IO_API_KEY?.trim()) {
    console.log("Final emails:", emailsFound)
    return emailsFound
  }

  if (emailsFound >= TARGET) {
    console.log("Final emails:", emailsFound)
    return emailsFound
  }

  const missing = TARGET - emailsFound

  const q = supabase.from("leads").select("id, email, website").order("id", { ascending: true })
  if (genCtx.mode === "campaign") {
    q.eq("campaign_id", genCtx.campaignId)
  } else {
    q.eq("audience_id", genCtx.audienceId)
  }

  const { data: allLeads, error } = await q
  if (error || !allLeads) {
    console.log("Final emails:", emailsFound)
    return emailsFound
  }

  const leadsWithoutEmail = allLeads
    .filter((l) => {
      const e = typeof l.email === "string" ? l.email.trim() : ""
      return !e || !isEmailAllowedForCampaignQueue(e)
    })
    .filter((l) => domainFromWebsiteUrl((l.website as string) ?? null))
    .slice(0, missing)

  for (let i = 0; i < leadsWithoutEmail.length; i += BATCH_SIZE) {
    if (emailsFound >= TARGET) break

    if (batchGuard && !(await batchGuard())) break

    console.log("Processing batch:", Math.floor(i / BATCH_SIZE) + 1)

    const batch = leadsWithoutEmail.slice(i, i + BATCH_SIZE)
    const enrichedResults = await Promise.all(
      batch.map(async (lead) => {
        try {
          const domain = domainFromWebsiteUrl((lead.website as string) ?? null)
          if (!domain) return { lead, enriched: null as string | null }
          const enriched = await enrichEmail(domain)
          return { lead, enriched }
        } catch (err) {
          console.log("[generate-leads] Hunter enrich failed", lead.id, err)
          return { lead, enriched: null as string | null }
        }
      })
    )

    for (const { lead, enriched } of enrichedResults) {
      if (emailsFound >= TARGET) break
      if (!enriched) continue

      const { error: upErr } = await supabase
        .from("leads")
        .update({ email: enriched, guessed_email: null })
        .eq("id", lead.id as string)

      if (!upErr) {
        emailsFound++
        if (audienceIdForProgress) {
          await updateProgress(supabase, audienceIdForProgress, emailsFound, "generating")
        }
      }
    }
  }

  emailsFound = await countEmailLeadsForContext(supabase, genCtx)
  console.log("Final emails:", emailsFound)
  return emailsFound
}

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "generate-leads")
  if (_ip) return _ip

  const serverAuth = await createServerClient()
  const {
    data: { user: sessionUser },
  } = await serverAuth.auth.getUser()
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const authUserId = sessionUser.id

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const campaignIdEarly =
    typeof body.campaign_id === "string" ? body.campaign_id : undefined

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const _dailyLimit = await dailyUsageLimitResponseIfExceeded(supabase, authUserId)
  if (_dailyLimit) return _dailyLimit

  {
    let blockQ = supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", authUserId)
      .or("status.eq.active,lead_generation_status.eq.generating")
    if (campaignIdEarly) {
      blockQ = blockQ.neq("id", campaignIdEarly)
    }
    const { data: blockingCampaigns } = await blockQ.limit(1)
    if (blockingCampaigns && blockingCampaigns.length > 0) {
      console.log("BLOCKED: campaign already running")
      return new Response(JSON.stringify({ error: "Campaign already running" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  {
    let coolQ = supabase
      .from("campaigns")
      .select("created_at")
      .eq("user_id", authUserId)
      .order("created_at", { ascending: false })
    if (campaignIdEarly) {
      coolQ = coolQ.neq("id", campaignIdEarly)
    }
    const { data: prevRows } = await coolQ.limit(1)
    const prev = prevRows?.[0] as { created_at?: string } | undefined
    if (prev?.created_at) {
      const ageMs = Date.now() - new Date(prev.created_at).getTime()
      if (ageMs >= 0 && ageMs < 60_000) {
        return NextResponse.json(
          {
            error: "Please wait a moment before starting another campaign.",
          },
          { status: 400 }
        )
      }
    }
  }

  let ctx: GenerationContext

  try {
    const b = body as {
      campaign_id?: string
      search_query?: string
      lead_cap?: number
      audience?: { id?: string; target_leads?: number }
    }
    // New flow: campaign-based with natural language search
    if (b.campaign_id && b.search_query) {
      const vCid = validateUuid(b.campaign_id, "campaign_id")
      if (!vCid.ok) return vCid.response
      const vSq = validateText(b.search_query, {
        required: true,
        maxLen: INPUT_MAX.long,
        field: "search_query",
      })
      if (!vSq.ok) return vSq.response
      const campaignId = vCid.value
      const searchQuery = vSq.value
      if (b.lead_cap !== undefined && b.lead_cap !== null) {
        const n = typeof b.lead_cap === "number" ? b.lead_cap : Number(b.lead_cap)
        if (
          !Number.isFinite(n) ||
          n < 1 ||
          n > SCRAPE_POLICY.maxLeadsPerScrape
        ) {
          return badRequest("lead_cap is invalid")
        }
        b.lead_cap = Math.floor(n)
      }
      console.log("[generate-leads] campaignId:", campaignId)
      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("id, user_id, location_lat, location_lng")
        .eq("id", campaignId)
        .single()
      if (campErr || !campaign) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
      }
      const { niche, location } = await parseSearchQuery(searchQuery)
      const latRaw = campaign.location_lat as number | string | null | undefined
      const lngRaw = campaign.location_lng as number | string | null | undefined
      const lat = typeof latRaw === "number" ? latRaw : latRaw != null ? Number(latRaw) : NaN
      const lng = typeof lngRaw === "number" ? lngRaw : lngRaw != null ? Number(lngRaw) : NaN
      const storedCampaignCoords =
        Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
      ctx = {
        mode: "campaign",
        campaignId,
        userId: campaign.user_id,
        searchQuery,
        niche,
        location,
        leadCap: Math.min(
          SCRAPE_POLICY.maxLeadsPerScrape,
          Math.min(DEFAULT_LEAD_CAP, b.lead_cap ?? DEFAULT_LEAD_CAP)
        ),
        storedCampaignCoords,
      }
    }
    // Legacy flow: audience-based (load owner from DB — do not trust body.user_id)
    else if (b.audience?.id) {
      const vAud = validateUuid(b.audience.id, "audience.id")
      if (!vAud.ok) return vAud.response
      const audienceId = vAud.value
      if (b.audience.target_leads != null) {
        const n = Number(b.audience.target_leads)
        if (
          !Number.isFinite(n) ||
          n < 1 ||
          n > SCRAPE_POLICY.maxLeadsPerScrape
        ) {
          return badRequest("target_leads is invalid")
        }
      }
      const { data: aud, error: audErr } = await supabase
        .from("audiences")
        .select("id, user_id, niche, location, target_leads")
        .eq("id", audienceId)
        .single()
      if (audErr || !aud) {
        return NextResponse.json({ error: "Audience not found" }, { status: 404 })
      }
      const rawTarget =
        b.audience.target_leads ?? (aud.target_leads as number | null)
      ctx = {
        mode: "audience",
        audienceId: aud.id as string,
        userId: aud.user_id as string,
        niche: (aud.niche as string) || "",
        location: (aud.location as string) || "",
        leadCap: Math.min(
          SCRAPE_POLICY.maxLeadsPerScrape,
          rawTarget ?? DEFAULT_LEAD_CAP
        ),
      }
    } else {
      return NextResponse.json(
        { error: "Provide campaign_id + search_query (new) or audience (legacy)" },
        { status: 400 }
      )
    }
  } catch (e) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (sessionUser.id !== ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "Google Places API key missing" }, { status: 500 })
  }

  const niche = ctx.niche
  const location = ctx.location
  const leadCap = Math.min(MAX_LEADS, ctx.leadCap)

  let primaryTarget: Awaited<ReturnType<typeof geocodeAddressToTarget>> = null

  if (ctx.mode === "campaign" && ctx.storedCampaignCoords) {
    primaryTarget = await reverseGeocodeToTarget(
      ctx.storedCampaignCoords.lat,
      ctx.storedCampaignCoords.lng,
      location,
      apiKey,
      safeFetch,
      safeJson
    )
    if (primaryTarget) {
      console.log("Using location-based search")
    } else {
      console.warn(
        "[generate-leads] Stored campaign coordinates present but reverse geocode failed; falling back to forward geocode"
      )
    }
  }

  if (!primaryTarget) {
    primaryTarget = await geocodeAddressToTarget(location, apiKey, safeFetch, safeJson)
    if (primaryTarget) {
      console.log(`Geocoded city → ${primaryTarget.lat},${primaryTarget.lng}`)
    }
  }

  if (!primaryTarget) {
    return NextResponse.json(
      { error: "Could not geocode target location. Try a more specific city or region." },
      { status: 400 }
    )
  }

  if (ctx.mode === "campaign") {
    await supabase
      .from("campaigns")
      .update({
        target_search_query: ctx.searchQuery,
        location_lat: primaryTarget.lat,
        location_lng: primaryTarget.lng,
      })
      .eq("id", ctx.campaignId)
  }

  if (
    !consumeRateLimit(
      `bf:scrape_start:${ctx.userId}`,
      RATE_LIMIT.scrapeStartPerUserPerMinute,
      60_000
    )
  ) {
    return tooManyRequestsJson(
      "Scrape start limit is 3 per minute. Try again shortly."
    )
  }
  if (!tryBeginScrapeForUser(ctx.userId)) {
    return tooManyRequestsJson(
      "Only one scrape can run at a time for your account. Wait for it to finish."
    )
  }

  let campaignWasDeleted = false

  try {
  // Fetch existing leads for deduplication (place_id, name+address, domain)
  const leadsQuery = supabase
    .from("leads")
    .select("place_id, name, address, website, email")
  if (ctx.mode === "audience") {
    leadsQuery.eq("audience_id", ctx.audienceId)
  } else {
    leadsQuery.eq("campaign_id", ctx.campaignId)
  }
  const { data: existingLeads } = await leadsQuery

  const seenPlaceIds = new Set<string>()
  const seenNameAddressKeys = new Set<string>()
  const seenContactKeys = new Set<string>()
  for (const row of existingLeads || []) {
    const pid = row.place_id as string | null
    if (pid) seenPlaceIds.add(pid)
    const addrPart = ((row.address as string) || "").slice(0, 48).toLowerCase()
    const naKey = `${String(row.name || "")
      .toLowerCase()
      .trim()}|${addrPart}`
    seenNameAddressKeys.add(naKey)
    const emExisting = typeof row.email === "string" ? row.email.trim() : ""
    if (emExisting) seenContactKeys.add(`e:${emExisting.toLowerCase()}`)
    seenContactKeys.add(
      contactKeyForCampaignLead({
        email: (row.email as string) ?? null,
        website: (row.website as string) ?? null,
        name: (row.name as string) ?? null,
        place_id: (row.place_id as string) ?? null,
      })
    )
  }

  const genCtx =
    ctx.mode === "campaign"
      ? ({ mode: "campaign" as const, campaignId: ctx.campaignId })
      : ({ mode: "audience" as const, audienceId: ctx.audienceId })

  async function assertCampaignNotDeleted(): Promise<boolean> {
    if (ctx.mode !== "campaign") return true
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", ctx.campaignId)
      .single()
    if (!campaign) {
      console.log("Campaign deleted, stopping scraper...")
      campaignWasDeleted = true
      return false
    }
    return true
  }

  let validLeadCount = await countValidLeadsForContext(supabase, genCtx)
  let emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
  let leadsCollected = await getLeadCount(supabase, ctx)

  if (ctx.mode === "audience" && leadsCollected >= leadCap) {
    console.log(`Audience already at lead cap (${leadCap}). Skipping generation.`)
    await updateProgress(supabase, ctx.audienceId, emailLeadsCount, "ready")
    return NextResponse.json({ success: true, count: emailLeadsCount, total: leadsCollected })
  }

  let skipCollectionLoop = false
  if (ctx.mode === "campaign" && leadsCollected >= leadCap) {
    const needContactFetch = await countCampaignLeadsNeedingContactFetch(supabase, ctx.campaignId)
    if (needContactFetch === 0) {
      await supabase
        .from("campaigns")
        .update({ lead_generation_status: "complete", lead_generation_stage: "complete" })
        .eq("id", ctx.campaignId)
      return NextResponse.json({
        success: true,
        count: emailLeadsCount,
        total: leadsCollected,
        validCount: emailLeadsCount,
      })
    }
    skipCollectionLoop = true
    console.log(
      `[generate-leads] ${needContactFetch} leads still need contact fetch; skipping Places collection`
    )
  }

  if (ctx.mode === "audience") {
    await updateProgress(supabase, ctx.audienceId, emailLeadsCount, "generating")
  }
  if (ctx.mode === "campaign") {
    await supabase
      .from("campaigns")
      .update({
        lead_generation_status: "generating",
        lead_generation_stage: skipCollectionLoop ? "enriching" : "searching",
      })
      .eq("id", ctx.campaignId)
  }

  async function enrichLead(lead: { id: string; place_id: string }): Promise<boolean> {
    const signal = AbortSignal.timeout(ENRICH_LEAD_TIMEOUT_MS)
    try {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
        lead.place_id
      )}&fields=website,formatted_phone_number&key=${apiKey}`
      const res = await fetch(detailsUrl, { signal })
      if (!res.ok) return false
      const details = (await res.json()) as {
        result?: { website?: string; formatted_phone_number?: string }
      }

      const website = details.result?.website ?? null
      const phoneFromDetails =
        details.result?.formatted_phone_number?.trim() || null

      let email: string | null = null
      let guessed_email: string | null = null
      if (website?.trim()) {
        const r = await scrapeEmailFromWebsite(website, signal)
        email = r.email
        guessed_email = r.guessedEmail
      }

      const domain = domainFromWebsiteUrl(website)
      if (!email && domain) {
        const hunter = await enrichEmail(domain)
        if (hunter && isEmailAllowedForCampaignQueue(hunter)) {
          email = hunter
        }
      }
      if (!email && domain) {
        const guessed = firstGuessableEmailForDomain(domain)
        if (guessed) {
          email = guessed
          guessed_email = guessed
        }
      }

      const updatePayload: Record<string, unknown> = {
        website: website || null,
        email: email || null,
        guessed_email: guessed_email ?? null,
      }
      if (phoneFromDetails) updatePayload.phone = phoneFromDetails

      const { error } = await supabase
        .from("leads")
        .update(updatePayload)
        .eq("id", lead.id)
      if (error) {
        console.log("Enrichment update failed, skipping", lead.place_id, error.message)
        return false
      }
      return true
    } catch (err) {
      const name = err instanceof Error ? err.name : ""
      if (name === "AbortError" || name === "TimeoutError") {
        console.log("Lead failed, skipping (timeout)", lead.id)
      } else {
        console.log("Lead failed, skipping", lead.id, err)
      }
      return false
    }
  }

  async function fetchWebsiteAndEmailForPlace(placeId: string): Promise<{
    website: string | null
    email: string | null
    guessedEmail: string | null
    phone: string | null
  }> {
    const signal = AbortSignal.timeout(ENRICH_LEAD_TIMEOUT_MS)
    try {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
        placeId
      )}&fields=website,formatted_phone_number&key=${apiKey}`
      const res = await fetch(detailsUrl, { signal })
      if (!res.ok) return { website: null, email: null, guessedEmail: null, phone: null }
      const details = (await res.json()) as {
        result?: { website?: string; formatted_phone_number?: string }
      }

      const website = details.result?.website ?? null
      const phoneRaw = details.result?.formatted_phone_number?.trim() ?? ""
      const phone = phoneRaw.length > 0 ? phoneRaw : null

      let email: string | null = null
      let guessedEmail: string | null = null
      if (website?.trim()) {
        const r = await scrapeEmailFromWebsite(website, signal)
        email = r.email
        guessedEmail = r.guessedEmail
      }

      const domain = domainFromWebsiteUrl(website)
      if (!email && domain) {
        const hunter = await enrichEmail(domain)
        if (hunter && isEmailAllowedForCampaignQueue(hunter)) {
          email = hunter
        }
      }
      if (!email && domain) {
        const guessed = firstGuessableEmailForDomain(domain)
        if (guessed) {
          email = guessed
          guessedEmail = guessed
        }
      }

      const trimmed = email?.trim() ?? ""
      const gTrim = guessedEmail?.trim() ?? ""
      return {
        website: website || null,
        email: trimmed.length > 0 ? trimmed : null,
        guessedEmail: gTrim.length > 0 ? gTrim : null,
        phone,
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : ""
      if (name !== "AbortError" && name !== "TimeoutError") {
        console.log("fetchWebsiteAndEmailForPlace failed", placeId, err)
      }
      return { website: null, email: null, guessedEmail: null, phone: null }
    }
  }

  /** One pass only: each place gets a single Details + scrape attempt (no retry rounds). */
  async function runCampaignContactFetchPhase(campaignId: string) {
    if (!(await assertCampaignNotDeleted())) return

    await supabase
      .from("campaigns")
      .update({ lead_generation_stage: "enriching" })
      .eq("id", campaignId)

    const { data: rows, error } = await supabase
      .from("leads")
      .select("id, place_id, email")
      .eq("campaign_id", campaignId)
    if (error || !rows) return

    const needsEnrich = rows.filter((r) => rowNeedsContactFetch(r))
    if (needsEnrich.length === 0) {
      console.log("[generate-leads] contact phase: nothing to enrich")
      return
    }

    console.log(
      `[generate-leads] contact phase (single pass): enriching ${needsEnrich.length} leads`
    )

    for (let i = 0; i < needsEnrich.length; i += BATCH_SIZE) {
      if (!(await assertCampaignNotDeleted())) return

      const chunk = needsEnrich.slice(i, i + BATCH_SIZE)
      console.log("Processing batch:", Math.floor(i / BATCH_SIZE) + 1)
      await Promise.all(
        chunk.map((row) =>
          (async () => {
            try {
              return await enrichLead({
                id: row.id as string,
                place_id: row.place_id as string,
              })
            } catch (err) {
              console.log("[generate-leads] enrichLead failed", row.id, err)
              return false
            }
          })()
        )
      )
      await scraperDelay(SCRAPER_CHUNK_DELAY_MS)
    }
  }

  async function runAudienceContactFetchPhase(audienceId: string) {
    const { data: rows, error } = await supabase
      .from("leads")
      .select("id, place_id, email")
      .eq("audience_id", audienceId)
    if (error || !rows) return

    const needsEnrich = rows.filter((r) => rowNeedsContactFetch(r))
    if (needsEnrich.length === 0) {
      console.log("[generate-leads] audience contact phase: nothing to enrich")
      return
    }

    console.log(
      `[generate-leads] audience contact phase: enriching ${needsEnrich.length} leads`
    )

    for (let i = 0; i < needsEnrich.length; i += BATCH_SIZE) {
      const chunk = needsEnrich.slice(i, i + BATCH_SIZE)
      console.log("Processing batch:", Math.floor(i / BATCH_SIZE) + 1)
      await Promise.all(
        chunk.map((row) =>
          (async () => {
            try {
              return await enrichLead({
                id: row.id as string,
                place_id: row.place_id as string,
              })
            } catch (err) {
              console.log("[generate-leads] enrichLead failed", row.id, err)
              return false
            }
          })()
        )
      )
      await scraperDelay(SCRAPER_CHUNK_DELAY_MS)
    }
  }

  let savedLeadRowsTotal = 0
  /** Places Nearby result rows seen (for final metrics; 0 if collection skipped). */
  let businessesScannedTotal = 0

  if (!skipCollectionLoop) {
  const aiExtraAreas = await expandLocationsWithAI(location, niche)
  const searchAreaStrings = mergeSearchAreaStringLists(
    buildAllSearchAreaStrings(location),
    aiExtraAreas
  ).slice(0, MAX_SEARCH_AREA_STRINGS)

  type SearchPoint = { area: string; lat: number; lng: number }
  type PlaceResult = {
    place_id?: string
    name?: string
    vicinity?: string
    formatted_address?: string
    rating?: number
    geometry?: { location: { lat: number; lng: number } }
  }
  const geocodedExpansion: SearchPoint[] = []
  for (let off = 0; off < searchAreaStrings.length; off += GEOCODE_BATCH_SIZE) {
    const chunk = searchAreaStrings.slice(off, off + GEOCODE_BATCH_SIZE)
    const geoResults = await Promise.all(
      chunk.map(async (area) => {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(area)}&key=${apiKey}`
        const res = await safeFetch(url)
        const geoData = await safeJson<{
          results?: { geometry: { location: { lat: number; lng: number } } }[]
        }>(res)
        if (geoData?.results?.length) {
          const lat = geoData.results[0].geometry.location.lat
          const lng = geoData.results[0].geometry.location.lng
          return { area, lat, lng }
        }
        return null
      })
    )
    geocodedExpansion.push(...geoResults.filter((p): p is SearchPoint => p !== null))
  }

  /** Primary anchor + string-geocoded areas; campaign mode also grows via CAMPAIGN_NEARBY_OFFSET_DEG each wave when under target. */
  const searchPoints: SearchPoint[] = []
  const seenCoord = new Set<string>()
  const pushPoint = (p: SearchPoint) => {
    const key = `${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`
    if (seenCoord.has(key)) return
    seenCoord.add(key)
    searchPoints.push(p)
  }
  pushPoint({
    area: primaryTarget.label,
    lat: primaryTarget.lat,
    lng: primaryTarget.lng,
  })
  for (const p of geocodedExpansion) pushPoint(p)

  let campaignGeoOffsetIdx = 0

  const rawKeywordVariants = await buildPlacesKeywordVariants(niche)
  const searchKeywords = (rawKeywordVariants.length ? rawKeywordVariants : [niche]).slice(
    0,
    MAX_KEYWORD_VARIANTS
  )
  console.log(
    `[generate-leads] anchor ${primaryTarget.lat.toFixed(4)},${primaryTarget.lng.toFixed(4)} | ${searchPoints.length} search centers | ${searchKeywords.length} keyword variants (Places Nearby)`
  )

  let businessesCollected = 0
  let uniqueBusinesses = 0
  let rawBusinessesSeen = 0
  const pageState = new Map<string, string | null>()
  /** Campaign: stop when email target met or businesses_scanned safety cap hit. */
  let stopCollecting = false
  let leadsLoggedAt = 0
  /** When true, Nearby smart-stop is skipped so Text Search can still reach `leadCap`. */
  let textSearchPhase = false

  function buildMultiQueryVariations(nicheStr: string, locationStr: string): string[] {
    const n = nicheStr.trim()
    const l = locationStr.trim()
    return [
      `${n} ${l}`,
      `${n} company ${l}`,
      `${n} services ${l}`,
      `${n} near ${l}`,
      `best ${n} ${l}`,
    ]
  }

  function buildBroadenedQueries(nicheStr: string, locationStr: string): string[] {
    const n = nicheStr.trim()
    const l = locationStr.trim()
    const firstToken = n.split(/\s+/)[0] || n
    return [`${l} businesses`, `${firstToken} ${l}`, l]
  }

  const TEXT_SEARCH_MAX_PAGES_PER_QUERY = 60
  const TEXT_SEARCH_BIAS_RADII_M = [35_000, 55_000, 85_000]

  async function ingestTextSearchPlacesForCampaign(places: PlaceResult[]): Promise<void> {
    if (ctx.mode !== "campaign" || places.length === 0) return
    let batch = [...places]
    let textSearchCampaignBatch = 0
    while (batch.length > 0) {
      if (!(await assertCampaignNotDeleted())) {
        stopCollecting = true
        return
      }

      leadsCollected = await getLeadCount(supabase, ctx)
      console.log("Current leads:", leadsCollected)
      if (leadsCollected >= leadCap) {
        stopCollecting = true
        return
      }

      textSearchCampaignBatch++
      console.log("Processing batch:", textSearchCampaignBatch)

      const slice = batch.splice(0, BATCH_SIZE)
      const enriched = await Promise.all(
        slice.map(async (p) => {
          try {
            const { website, email, guessedEmail, phone } =
              await fetchWebsiteAndEmailForPlace(p.place_id!)
            return { place: p, website, email, guessedEmail, phone }
          } catch (err) {
            console.log("[generate-leads] fetchWebsiteAndEmailForPlace failed", p.place_id, err)
            return {
              place: p,
              website: null,
              email: null,
              guessedEmail: null,
              phone: null,
            }
          }
        })
      )
      enriched.sort((a, b) => {
        const score = (w: string | null) => (w?.trim() ? 1 : 0)
        return score(b.website) - score(a.website)
      })
      await scraperDelay(SCRAPER_CHUNK_DELAY_MS)

      for (let i = 0; i < enriched.length; i++) {
        leadsCollected = await getLeadCount(supabase, ctx)
        if (leadsCollected >= leadCap) {
          stopCollecting = true
          return
        }
        const { place, website, email, guessedEmail, phone } = enriched[i]
        const allowedEmail =
          email && isEmailAllowedForCampaignQueue(email) ? email : null
        const row: LeadRowInput = {
          user_id: ctx.userId,
          name: place.name,
          company: place.name,
          address: place.vicinity || place.formatted_address || null,
          google_rating: place.rating ?? null,
          status: "cold",
          place_id: place.place_id,
          website: website?.trim() ? website : null,
          phone: phone?.trim() ? phone : null,
          email: allowedEmail,
          guessed_email:
            allowedEmail && guessedEmail && guessedEmail === allowedEmail
              ? guessedEmail
              : null,
        }
        const inserted = await insertOneCampaignLeadIfUnderCap(
          supabase,
          ctx.campaignId,
          row,
          leadCap,
          leadsCollected,
          seenContactKeys
        )
        if (inserted) {
          leadsCollected++
          if (allowedEmail) emailLeadsCount++
          savedLeadRowsTotal++
          console.log("Leads collected:", leadsCollected)
        }
      }
    }
  }

  async function ingestTextSearchPlacesForAudience(places: PlaceResult[]): Promise<void> {
    if (ctx.mode !== "audience" || places.length === 0) return
    let batch = [...places]
    let textSearchAudienceBatch = 0
    while (batch.length > 0) {
      leadsCollected = await getLeadCount(supabase, ctx)
      console.log("Current leads:", leadsCollected)
      if (leadsCollected >= leadCap) return

      textSearchAudienceBatch++
      console.log("Processing batch:", textSearchAudienceBatch)

      const slice = batch.splice(0, BATCH_SIZE)
      const enrichedAudience = await Promise.all(
        slice.map(async (p) => {
          try {
            const { website, email, guessedEmail, phone } =
              await fetchWebsiteAndEmailForPlace(p.place_id!)
            return { place: p, website, email, guessedEmail, phone }
          } catch (err) {
            console.log("[generate-leads] fetchWebsiteAndEmailForPlace failed", p.place_id, err)
            return {
              place: p,
              website: null,
              email: null,
              guessedEmail: null,
              phone: null,
            }
          }
        })
      )
      enrichedAudience.sort((a, b) => {
        const score = (w: string | null) => (w?.trim() ? 1 : 0)
        return score(b.website) - score(a.website)
      })
      await scraperDelay(SCRAPER_CHUNK_DELAY_MS)

      const audienceRows: Record<string, unknown>[] = []
      for (let j = 0; j < enrichedAudience.length; j++) {
        const { place, website, email, guessedEmail, phone } = enrichedAudience[j]
        const allowedEmail =
          email && isEmailAllowedForCampaignQueue(email) ? email : null
        audienceRows.push({
          user_id: ctx.userId,
          name: place.name,
          company: place.name,
          address: place.vicinity || place.formatted_address || null,
          google_rating: place.rating || null,
          status: "cold",
          place_id: place.place_id,
          website: website?.trim() ? website : null,
          phone: phone?.trim() ? phone : null,
          email: allowedEmail,
          guessed_email:
            allowedEmail && guessedEmail && guessedEmail === allowedEmail
              ? guessedEmail
              : null,
          audience_id: ctx.audienceId,
        })
      }
      if (audienceRows.length === 0) continue

      leadsCollected = await getLeadCount(supabase, ctx)
      let rows = audienceRows
      if (leadsCollected + rows.length > leadCap) {
        const remaining = leadCap - leadsCollected
        rows = audienceRows.slice(0, Math.max(0, remaining))
      }
      if (rows.length === 0) return

      try {
        const { data: inserted, error: insertError } = await supabase
          .from("leads")
          .insert(rows)
          .select("id, place_id")
        if (insertError) {
          console.log("Text search insert error:", insertError.message)
        } else if (inserted) {
          savedLeadRowsTotal += inserted.length
          leadsCollected = await getLeadCount(supabase, ctx)
          emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
          console.log("Leads collected:", leadsCollected)
        }
      } catch (err) {
        console.log("Text search batch insert error:", err)
      }
    }
  }

  function tryStopCampaignScrape(): boolean {
    if (ctx.mode !== "campaign" || stopCollecting) return stopCollecting
    if (leadsCollected >= leadCap) {
      stopCollecting = true
      console.log(
        `[generate-leads] scrape stop: leads>=${leadCap} | businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
      )
      return true
    }
    if (
      !textSearchPhase &&
      rawBusinessesSeen >= SMART_STOP_MAX_BUSINESSES_SCANNED
    ) {
      stopCollecting = true
      console.log(
        `[generate-leads] scrape stop: businesses_scanned>=${SMART_STOP_MAX_BUSINESSES_SCANNED} | businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
      )
      return true
    }
    return false
  }

  function campaignUnderSmartLimits(): boolean {
    if (ctx.mode !== "campaign") return true
    return (
      leadsCollected < leadCap &&
      rawBusinessesSeen < SMART_STOP_MAX_BUSINESSES_SCANNED
    )
  }

  function collectTextSearchNewCandidates(results: PlaceResult[]): PlaceResult[] {
    const out: PlaceResult[] = []
    const target = primaryTarget
    if (!target) return out
    for (const place of results) {
      if (rawBusinessesSeen >= MAX_RAW_BUSINESSES) break
      rawBusinessesSeen++
      const placeId = place.place_id
      if (!placeId || seenPlaceIds.has(placeId)) continue
      if (
        !isNearbyPlaceInTargetRegion(
          place,
          { lat: target.lat, lng: target.lng },
          80_000,
          target
        )
      ) {
        continue
      }
      const addrPart = (place.vicinity || place.formatted_address || "").slice(0, 48).toLowerCase()
      const naKey = `${(place.name || "").toLowerCase().trim()}|${addrPart}`
      if (seenNameAddressKeys.has(naKey)) continue
      seenNameAddressKeys.add(naKey)
      seenPlaceIds.add(placeId)
      out.push(place)
    }
    return out
  }

  let wave = 0
  let consecutiveEmptyWaves = 0
  while (true) {
    if (stopCollecting) break

    if (!(await assertCampaignNotDeleted())) break

    validLeadCount = await countValidLeadsForContext(supabase, genCtx)
    emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
    leadsCollected = await getLeadCount(supabase, ctx)

    if (ctx.mode === "campaign") {
      if (tryStopCampaignScrape()) break
    } else if (leadsCollected >= leadCap) {
      console.log(`Lead row target reached: ${leadsCollected}/${leadCap}`)
      break
    }
    if (rawBusinessesSeen >= SMART_STOP_MAX_BUSINESSES_SCANNED) {
      if (ctx.mode === "audience") {
        console.log(
          `[generate-leads] audience stop: businesses_scanned>=${SMART_STOP_MAX_BUSINESSES_SCANNED} | businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
        )
      }
      break
    }
    if (rawBusinessesSeen >= MAX_RAW_BUSINESSES) {
      console.log(`Raw scrape cap (${MAX_RAW_BUSINESSES}) reached`)
      break
    }

    wave++

    let appendedGeoCenter = false
    if (
      !stopCollecting &&
      ctx.mode === "campaign" &&
      campaignUnderSmartLimits() &&
      campaignGeoOffsetIdx < CAMPAIGN_NEARBY_OFFSET_DEG.length &&
      wave > 1
    ) {
      const o = CAMPAIGN_NEARBY_OFFSET_DEG[campaignGeoOffsetIdx]
      campaignGeoOffsetIdx++
      const nlat = primaryTarget.lat + o.lat
      const nlng = primaryTarget.lng + o.lng
      pushPoint({
        area: `${primaryTarget.label} (nearby +${o.lat}, ${o.lng})`,
        lat: nlat,
        lng: nlng,
      })
      appendedGeoCenter = true
      console.log(
        `[generate-leads] Nearby expansion center ${nlat.toFixed(4)},${nlng.toFixed(4)} (offset ${o.lat},${o.lng}) wave ${wave}`
      )
    }

    if (ctx.mode === "campaign" && !campaignWasDeleted) {
      await supabase
        .from("campaigns")
        .update({
          lead_generation_stage:
            wave === 1 ? "searching" : appendedGeoCenter ? "expanding" : "searching",
        })
        .eq("id", ctx.campaignId)
    }

    const savedThisWave: { id: string; place_id: string }[] = []
    const campaignPlaceBuffer: PlaceResult[] = []
    let campaignFlushBatch = 0

    async function flushCampaignPlaceBuffer(): Promise<void> {
      if (ctx.mode !== "campaign" || campaignPlaceBuffer.length === 0) return

      while (campaignPlaceBuffer.length > 0 && !stopCollecting) {
        if (tryStopCampaignScrape()) return

        if (!(await assertCampaignNotDeleted())) {
          campaignPlaceBuffer.length = 0
          return
        }

        campaignFlushBatch++
        console.log("Processing batch:", campaignFlushBatch)

        const chunk = campaignPlaceBuffer.splice(0, BATCH_SIZE)
        emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
        leadsCollected = await getLeadCount(supabase, ctx)
        if (tryStopCampaignScrape()) return

        const enriched = await Promise.all(
          chunk.map(async (p) => {
            try {
              const { website, email, guessedEmail, phone } =
                await fetchWebsiteAndEmailForPlace(p.place_id!)
              return { place: p, website, email, guessedEmail, phone }
            } catch (err) {
              console.log("[generate-leads] fetchWebsiteAndEmailForPlace failed", p.place_id, err)
              return {
                place: p,
                website: null,
                email: null,
                guessedEmail: null,
                phone: null,
              }
            }
          })
        )
        enriched.sort((a, b) => {
          const score = (w: string | null) => (w?.trim() ? 1 : 0)
          return score(b.website) - score(a.website)
        })
        await scraperDelay(SCRAPER_CHUNK_DELAY_MS)

        for (let i = 0; i < enriched.length; i++) {
          if (tryStopCampaignScrape()) return

          const { place, website, email, guessedEmail, phone } = enriched[i]
          const allowedEmail =
            email && isEmailAllowedForCampaignQueue(email) ? email : null

          const row: LeadRowInput = {
            user_id: ctx.userId,
            name: place.name,
            company: place.name,
            address: place.vicinity || place.formatted_address || null,
            google_rating: place.rating ?? null,
            status: "cold",
            place_id: place.place_id,
            website: website?.trim() ? website : null,
            phone: phone?.trim() ? phone : null,
            email: allowedEmail,
            guessed_email:
              allowedEmail && guessedEmail && guessedEmail === allowedEmail
                ? guessedEmail
                : null,
          }

          const inserted = await insertOneCampaignLeadIfUnderCap(
            supabase,
            ctx.campaignId,
            row,
            leadCap,
            leadsCollected,
            seenContactKeys
          )
          if (inserted) {
            leadsCollected++
            if (allowedEmail) emailLeadsCount++
            savedThisWave.push(inserted)
            console.log("Leads collected:", leadsCollected)
            if (
              leadsCollected - leadsLoggedAt >= 5 ||
              leadsCollected >= leadCap
            ) {
              leadsLoggedAt = leadsCollected
              console.log(
                `[generate-leads] metrics: businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
              )
            }
            if (tryStopCampaignScrape()) return
          }
        }
      }
    }

    outer: for (let pi = 0; pi < searchPoints.length; pi++) {
      if (stopCollecting) break outer

      if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break outer

      const point = searchPoints[pi]
      emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
      leadsCollected = await getLeadCount(supabase, ctx)
      if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
      if (ctx.mode === "audience" && leadsCollected >= leadCap) break outer

      for (let r = 0; r < RADIUS_STEPS.length; r++) {
        if (stopCollecting) break outer

        if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break outer

        const radius = RADIUS_STEPS[r]
        emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
        leadsCollected = await getLeadCount(supabase, ctx)
        if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
        if (ctx.mode === "audience" && leadsCollected >= leadCap) break outer

        console.log(`Searching area: ${point.area}, radius ${radius}m (wave ${wave})`)

        for (let ki = 0; ki < searchKeywords.length; ki++) {
          if (stopCollecting) break outer

          if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break outer

          emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
          leadsCollected = await getLeadCount(supabase, ctx)
          if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
          if (ctx.mode === "audience") {
            if (leadsCollected >= leadCap) break outer
            if (rawBusinessesSeen >= SMART_STOP_MAX_BUSINESSES_SCANNED) break outer
          }

          const keyword = searchKeywords[ki]
          const pageKey = `${pi}|${r}|${ki}`
          console.log(`Using keyword: ${keyword}`)

          let pageNum = 0
          let lastPageSize = 0

          while (true) {
            if (stopCollecting) break outer

            if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break outer

            emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
            leadsCollected = await getLeadCount(supabase, ctx)
            if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
            if (ctx.mode === "audience") {
              if (leadsCollected >= leadCap) break outer
              if (rawBusinessesSeen >= SMART_STOP_MAX_BUSINESSES_SCANNED) break outer
            }
            if (rawBusinessesSeen >= MAX_RAW_BUSINESSES) break outer

            const requestToken = pageState.get(pageKey) ?? null
            let url: string
            if (!requestToken) {
              if (stopCollecting) break outer
              if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
              url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${point.lat},${point.lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${apiKey}`
            } else {
              if (stopCollecting) break outer
              if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
              await new Promise((delay) => setTimeout(delay, PAGE_TOKEN_DELAY_MS))
              console.log("Fetching next page...")
              console.log("Continuing scrape...")
              url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${requestToken}&key=${apiKey}`
            }

          const res = await safeFetch(url)
          const data = await safeJson<{ results?: PlaceResult[]; error_message?: string; next_page_token?: string }>(res)
          if (!data) {
            console.log("Places API fetch/parse failed, skipping page")
            break
          }
          if (data.error_message) {
            console.error("Places API error:", data.error_message)
            break
          }

          const results = data.results || []
          lastPageSize = results.length
          businessesCollected += results.length
          rawBusinessesSeen += results.length
          if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer
          if (
            ctx.mode === "audience" &&
            rawBusinessesSeen >= SMART_STOP_MAX_BUSINESSES_SCANNED
          ) {
            console.log(
              `[generate-leads] audience stop: businesses_scanned>=${SMART_STOP_MAX_BUSINESSES_SCANNED} | businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
            )
            break outer
          }

          const nextToken = data.next_page_token ?? null
          pageState.set(pageKey, nextToken)

          if (results.length === 0 && !requestToken) {
            break
          }

          const candidatePlaces: PlaceResult[] = []
          for (const place of results) {
            if (stopCollecting) break outer

            if (ctx.mode === "audience") {
              emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
              leadsCollected = await getLeadCount(supabase, ctx)
              if (leadsCollected >= leadCap) break outer
            }
            if (ctx.mode === "campaign" && tryStopCampaignScrape()) break outer

            const placeId = place.place_id
            if (!placeId || seenPlaceIds.has(placeId)) continue
            if (
              !isNearbyPlaceInTargetRegion(place, { lat: point.lat, lng: point.lng }, radius, primaryTarget)
            ) {
              continue
            }
            const addrPart = (place.vicinity || place.formatted_address || "").slice(0, 48).toLowerCase()
            const naKey = `${(place.name || "").toLowerCase().trim()}|${addrPart}`
            if (seenNameAddressKeys.has(naKey)) continue
            seenNameAddressKeys.add(naKey)
            seenPlaceIds.add(placeId)
            uniqueBusinesses++

            if (ctx.mode === "campaign") {
              campaignPlaceBuffer.push(place)
              if (campaignPlaceBuffer.length >= BATCH_SIZE) {
                await flushCampaignPlaceBuffer()
                if (stopCollecting) break outer
              }
            } else {
              candidatePlaces.push(place)
            }
          }

          if (stopCollecting) break outer

          if (ctx.mode === "campaign" && campaignPlaceBuffer.length > 0) {
            await flushCampaignPlaceBuffer()
            if (stopCollecting) break outer
          }

          if (ctx.mode === "audience" && candidatePlaces.length > 0) {
            const placeIds = candidatePlaces.map((p) => p.place_id).filter(Boolean) as string[]
            const { data: existingByPlace } = await supabase
              .from("leads")
              .select("place_id")
              .eq("audience_id", ctx.audienceId)
              .in("place_id", placeIds)
            const existingSet = new Set((existingByPlace || []).map((l) => l.place_id))

            const toInsert = candidatePlaces.filter((p) => p.place_id && !existingSet.has(p.place_id))

            for (let off = 0; off < toInsert.length; off += BATCH_SIZE) {
              if (stopCollecting) break outer
              emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
              leadsCollected = await getLeadCount(supabase, ctx)
              if (leadsCollected >= leadCap) break outer

              console.log("Processing batch:", Math.floor(off / BATCH_SIZE) + 1)

              const chunk = toInsert.slice(off, off + BATCH_SIZE)
              const enrichedAudience = await Promise.all(
                chunk.map(async (p) => {
                  try {
                    const { website, email, guessedEmail, phone } =
                      await fetchWebsiteAndEmailForPlace(p.place_id!)
                    return { place: p, website, email, guessedEmail, phone }
                  } catch (err) {
                    console.log(
                      "[generate-leads] fetchWebsiteAndEmailForPlace failed",
                      p.place_id,
                      err
                    )
                    return {
                      place: p,
                      website: null,
                      email: null,
                      guessedEmail: null,
                      phone: null,
                    }
                  }
                })
              )
              enrichedAudience.sort((a, b) => {
                const score = (w: string | null) => (w?.trim() ? 1 : 0)
                return score(b.website) - score(a.website)
              })
              await scraperDelay(SCRAPER_CHUNK_DELAY_MS)
              const audienceRows: Record<string, unknown>[] = []
              for (let j = 0; j < enrichedAudience.length; j++) {
                const { place, website, email, guessedEmail, phone } = enrichedAudience[j]
                const allowedEmail =
                  email && isEmailAllowedForCampaignQueue(email) ? email : null
                audienceRows.push({
                  user_id: ctx.userId,
                  name: place.name,
                  company: place.name,
                  address: place.vicinity || place.formatted_address || null,
                  google_rating: place.rating || null,
                  status: "cold",
                  place_id: place.place_id,
                  website: website?.trim() ? website : null,
                  phone: phone?.trim() ? phone : null,
                  email: allowedEmail,
                  guessed_email:
                    allowedEmail && guessedEmail && guessedEmail === allowedEmail
                      ? guessedEmail
                      : null,
                  audience_id: ctx.audienceId,
                })
              }

              if (audienceRows.length === 0) continue

              leadsCollected = await getLeadCount(supabase, ctx)
              let rows = audienceRows
              if (leadsCollected + rows.length > leadCap) {
                const remaining = leadCap - leadsCollected
                rows = audienceRows.slice(0, Math.max(0, remaining))
              }
              if (rows.length === 0) break outer

              try {
                const { data: inserted, error: insertError } = await supabase
                  .from("leads")
                  .insert(rows)
                  .select("id, place_id")
                if (insertError) {
                  console.log("Insert error, continuing:", insertError.message)
                } else if (inserted) {
                  savedThisWave.push(...inserted)
                  leadsCollected = await getLeadCount(supabase, ctx)
                  emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
                  console.log("Leads collected:", leadsCollected)
                }
              } catch (err) {
                console.log("Batch insert error, continuing:", err)
              }
            }
          }

          if (stopCollecting) break outer

          leadsCollected = await getLeadCount(supabase, ctx)
          emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
          if (rawBusinessesSeen % 100 === 0 || !nextToken) {
            console.log(
              `[generate-leads] metrics: businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
            )
          }

          if (ctx.mode === "audience") {
            await updateProgress(supabase, ctx.audienceId, leadsCollected, "generating")
          }

          console.log("Leads collected:", leadsCollected)
          if (!nextToken) break
          if (leadsCollected >= leadCap) break
          pageNum++
          if (pageNum >= MAX_PLACE_PAGES_PER_SEARCH) {
            console.log("Continuing scrape...")
            break
          }
        }
        }

        if (r < RADIUS_STEPS.length - 1) {
          console.log(
            `Expanding search radius (${RADIUS_STEPS[r]}m → ${RADIUS_STEPS[r + 1]}m)...`
          )
        }
      }
    }

    if (ctx.mode === "campaign" && campaignPlaceBuffer.length > 0) {
      await flushCampaignPlaceBuffer()
    }

    if (ctx.mode === "campaign") {
      emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
      leadsCollected = await getLeadCount(supabase, ctx)
      tryStopCampaignScrape()
    }

    if (stopCollecting && savedThisWave.length === 0) {
      console.log(
        `[generate-leads] stop with no new inserts this wave | businesses_scanned=${rawBusinessesSeen} leads_saved=${leadsCollected} emails_found=${emailLeadsCount}`
      )
      break
    }

    if (savedThisWave.length === 0) {
      validLeadCount = await countValidLeadsForContext(supabase, genCtx)
      emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
      leadsCollected = await getLeadCount(supabase, ctx)
      if (ctx.mode === "campaign" && tryStopCampaignScrape()) {
        break
      }
      if (ctx.mode === "audience" && leadsCollected >= leadCap) {
        console.log(`Lead row target reached after empty wave: ${leadsCollected}/${leadCap}`)
        break
      }
      if (rawBusinessesSeen >= MAX_RAW_BUSINESSES) {
        console.log("Raw scrape cap reached with no new inserts")
        break
      }
      consecutiveEmptyWaves++
      if (consecutiveEmptyWaves >= MAX_CONSECUTIVE_EMPTY_WAVES) {
        console.log(`Stopping after ${MAX_CONSECUTIVE_EMPTY_WAVES} consecutive empty waves`)
        break
      }
      console.log(
        `Scrape wave produced no new inserts (${consecutiveEmptyWaves}/${MAX_CONSECUTIVE_EMPTY_WAVES}); continuing`
      )
      continue
    }

    consecutiveEmptyWaves = 0
    savedLeadRowsTotal += savedThisWave.length

    if (ctx.mode === "audience") {
      emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
      await updateProgress(supabase, ctx.audienceId, emailLeadsCount, "generating")
    }
    if (ctx.mode === "campaign" && !campaignWasDeleted) {
      await supabase
        .from("campaigns")
        .update({
          lead_generation_stage: appendedGeoCenter ? "expanding" : "searching",
        })
        .eq("id", ctx.campaignId)
    }

    console.log(
      `Wave ${wave} complete: ${savedThisWave.length} new leads inserted`
    )

    validLeadCount = await countValidLeadsForContext(supabase, genCtx)
    emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
    if (ctx.mode === "audience") {
      await updateProgress(supabase, ctx.audienceId, emailLeadsCount, "generating")
    }
    if (ctx.mode === "campaign" && stopCollecting) {
      break
    }
  }

    if (!campaignWasDeleted) {
      stopCollecting = false
      textSearchPhase = true
      leadsCollected = await getLeadCount(supabase, ctx)
      console.log("Current leads:", leadsCollected)

      if (leadsCollected < leadCap && primaryTarget) {
        const textSearchAnchor = primaryTarget
        if (ctx.mode === "campaign") {
          await supabase
            .from("campaigns")
            .update({ lead_generation_stage: "searching" })
            .eq("id", ctx.campaignId)
        }

        for (let ri = 0; ri < TEXT_SEARCH_BIAS_RADII_M.length; ri++) {
          if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break

          const radiusBias = TEXT_SEARCH_BIAS_RADII_M[ri]
          const useBroadQueries = ri > 0
          const queries = useBroadQueries
            ? [
                ...buildMultiQueryVariations(niche, location),
                ...buildBroadenedQueries(niche, location),
              ]
            : buildMultiQueryVariations(niche, location)

          for (const query of queries) {
            if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break

            console.log("Switching query:", query)
            let pageToken: string | null = null
            let pageNum = 0

            while (true) {
              if (ctx.mode === "campaign" && !(await assertCampaignNotDeleted())) break

              leadsCollected = await getLeadCount(supabase, ctx)
              console.log("Current leads:", leadsCollected)
              if (leadsCollected >= leadCap) break
              if (rawBusinessesSeen >= MAX_RAW_BUSINESSES) break

              let url: string
              if (!pageToken) {
                url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
                  query
                )}&location=${textSearchAnchor.lat},${textSearchAnchor.lng}&radius=${radiusBias}&key=${apiKey}`
              } else {
                await new Promise((r) => setTimeout(r, PAGE_TOKEN_DELAY_MS))
                console.log("Continuing scrape...")
                url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(
                  pageToken
                )}&key=${apiKey}`
              }

              const res = await safeFetch(url)
              const data = await safeJson<{
                results?: PlaceResult[]
                next_page_token?: string
                error_message?: string
              }>(res)
              if (!data || data.error_message) {
                if (data?.error_message) {
                  console.error("[generate-leads] Text Search error:", data.error_message)
                }
                break
              }

              const results = data.results ?? []
              const candidates = collectTextSearchNewCandidates(results)
              if (ctx.mode === "campaign") {
                await ingestTextSearchPlacesForCampaign(candidates)
              } else {
                await ingestTextSearchPlacesForAudience(candidates)
              }

              pageToken = data.next_page_token ?? null
              pageNum++
              if (!pageToken) break
              if (pageNum >= TEXT_SEARCH_MAX_PAGES_PER_QUERY) break

              leadsCollected = await getLeadCount(supabase, ctx)
              if (leadsCollected >= leadCap) break
            }

            leadsCollected = await getLeadCount(supabase, ctx)
            if (leadsCollected >= leadCap) break
          }

          leadsCollected = await getLeadCount(supabase, ctx)
          if (leadsCollected >= leadCap) break
        }
      }
    }

    textSearchPhase = false
    leadsCollected = await getLeadCount(supabase, ctx)
    console.log("Current leads:", leadsCollected)

    businessesScannedTotal = rawBusinessesSeen
  } // end if (!skipCollectionLoop)

  if (ctx.mode === "campaign" && !campaignWasDeleted) {
    await runCampaignContactFetchPhase(ctx.campaignId)
  }
  if (ctx.mode === "audience") {
    await runAudienceContactFetchPhase(ctx.audienceId)
  }

  emailLeadsCount = await countEmailLeadsForContext(supabase, genCtx)
  emailLeadsCount = await runHunterFallbackToEmailTarget(
    supabase,
    genCtx,
    leadCap,
    ctx.mode === "audience" ? ctx.audienceId : undefined,
    ctx.mode === "campaign" && !campaignWasDeleted ? assertCampaignNotDeleted : undefined
  )

  validLeadCount = await countValidLeadsForContext(supabase, genCtx)
  leadsCollected = await getLeadCount(supabase, ctx)

  await trimLeadRowsToCap(supabase, ctx, leadCap)
  leadsCollected = await getLeadCount(supabase, ctx)

  if (emailLeadsCount < leadCap) {
    console.log(
      `Source exhausted: ${emailLeadsCount} email leads (target was ${leadCap}). Total rows: ${leadsCollected}`
    )
  }

  console.log(
    `[generate-leads] complete | businesses_scanned=${businessesScannedTotal} leads_saved=${leadsCollected} emails_found=${emailLeadsCount} | inserted_this_run=${savedLeadRowsTotal} valid_metric=${validLeadCount}`
  )

  if (ctx.mode === "audience") {
    const finalStatus = leadsCollected >= leadCap ? "ready" : "market_exhausted"
    await updateProgress(supabase, ctx.audienceId, leadsCollected, finalStatus)
  }

  if (ctx.mode === "campaign" && !campaignWasDeleted) {
    leadsCollected = await getLeadCount(supabase, ctx)
    const scrapeComplete = leadsCollected >= leadCap
    await supabase
      .from("campaigns")
      .update({
        lead_generation_status: scrapeComplete ? "complete" : "partial",
        lead_generation_stage: scrapeComplete ? "complete" : "searching",
      })
      .eq("id", ctx.campaignId)
  }

  return NextResponse.json({
    success: true,
    count: savedLeadRowsTotal,
    total: leadsCollected,
    validCount: emailLeadsCount,
  })
  } catch (err) {
    console.error("Lead generation failed:", err)
    if (ctx.mode === "audience") {
      await supabase
        .from("audiences")
        .update({ status: "failed" })
        .eq("id", ctx.audienceId)
    }
    if (typeof ctx !== "undefined" && ctx.mode === "campaign" && !campaignWasDeleted) {
      await supabase
        .from("campaigns")
        .update({ lead_generation_status: "failed" })
        .eq("id", ctx.campaignId)
    }
    return NextResponse.json(
      { error: "Lead generation failed" },
      { status: 500 }
    )
  } finally {
    endScrapeForUser(ctx.userId)
  }
}
