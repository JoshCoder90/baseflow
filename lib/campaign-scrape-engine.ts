/**
 * Campaign lead scraping split into serverless-safe batches with DB checkpointing.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  contactKeyForCampaignLead,
  insertOneCampaignLeadIfUnderCap,
  type LeadRowInput,
  MAX_LEADS_PER_CAMPAIGN,
} from "@/lib/campaign-leads-insert"
import {
  buildAllSearchAreaStrings,
  buildPlacesKeywordVariants,
  expandLocationsWithAI,
  mergeSearchAreaStringLists,
} from "@/lib/lead-search-expansion"
import { countEmailLeadsForContext } from "@/lib/lead-validity"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"
import {
  firstGuessableEmailForDomain,
  normalizeWebsiteUrl,
  scrapeEmailFromWebsite,
} from "@/lib/email-enrichment"
import { enrichEmail } from "@/lib/hunter-domain-enrich"
import { ensureInitialCampaignMessageForLead } from "@/lib/campaign-schedule"
import { CAMPAIGN_NEARBY_OFFSET_DEG } from "@/lib/campaign-geo-expansion"
import {
  geocodeAddressToTarget,
  isNearbyPlaceInTargetRegion,
  reverseGeocodeToTarget,
  type GeocodedTarget,
} from "@/lib/location-targeting"
import { parseSearchQuery } from "@/lib/parse-search-query"
import { SCRAPE_POLICY } from "@/lib/rate-limit-policy"
import {
  consumeGoogleMapsApiSlot,
  MAX_GOOGLE_MAPS_API_CALLS_PER_CAMPAIGN_SCRAPE,
  safeGoogleCall,
} from "@/lib/google-maps-api-budget"

const MAX_LEADS = SCRAPE_POLICY.maxLeadsPerScrape
const RADIUS_STEPS = [5000, 10000, 20000, 50000]
/** Legacy Nearby Search returns a fixed payload shape; field masks are not supported on this endpoint. */
const MAX_RADIUS_STEPS = 3
const MAX_PLACE_PAGES_PER_SEARCH = 5
/** Next-page token pacing for Places pagination (too low → INVALID_REQUEST spikes). */
const PAGE_TOKEN_DELAY_MS = 950
/** Places rows processed per inner slice (keep aligned with {@link SCRAPE_BATCH_INSERT_BUDGET}). */
const BATCH_SIZE = 36
const SMART_STOP_MAX_BUSINESSES_SCANNED = 4000
const MAX_RAW_BUSINESSES = 2500
const MAX_CONSECUTIVE_EMPTY_WAVES = 3
const MAX_SEARCH_AREA_STRINGS = 52
const GEOCODE_BATCH_SIZE = 10
const MAX_KEYWORD_VARIANTS = 24
const FETCH_TIMEOUT_MS = 20000
const ENRICH_LEAD_TIMEOUT_MS = 8000
const TEXT_SEARCH_MAX_PAGES_PER_QUERY = 5
const TEXT_SEARCH_BIAS_RADII_M = [35_000, 55_000, 85_000]

/**
 * Max **new lead inserts** per `/api/scrape-batch` HTTP request (not a Google billing unit).
 * Larger = fewer round trips = faster; route `maxDuration` must allow enrichment + Places work.
 */
export const SCRAPE_BATCH_INSERT_BUDGET = 36

/** Hunter.io domain lookups per full campaign scrape (checkpointed — spans all batches). */
const MAX_HUNTER_DOMAIN_LOOKUPS_PER_CAMPAIGN_SCRAPE = 110

export type CampaignScrapeCheckpoint = {
  v: 1
  niche: string
  location: string
  primaryTarget: GeocodedTarget
  searchPoints: SearchPoint[]
  searchKeywords: string[]
  wave: number
  consecutiveEmptyWaves: number
  campaignGeoOffsetIdx: number
  rawBusinessesSeen: number
  stopCollecting: boolean
  pageState: Record<string, string | null>
  pi: number
  r: number
  ki: number
  nearbyInnerPageNum: number
  campaignPlaceBuffer: PlaceResult[]
  savedThisWavePlaceIds: string[]
  collectPhase: "nearby_waves" | "text_search" | "collection_done"
  textRi: number
  textQueryIdx: number
  textQueries: string[]
  textPageToken: string | null
  textPageNum: number
  postPhase: "none" | "hunter_trim" | "done"
  contactFetchOffset: number
  /** Cumulative Google Maps HTTP calls for this campaign scrape (checkpointed across batches). */
  apiCalls?: number
  /** Hunter.io attempts used this campaign (checkpointed). */
  hunterCallsUsed?: number
  /** When true, skip further Places/Geocoding (budget hit); finalize scrape without text-search. */
  apiBudgetExhausted?: boolean
  /** Dedupe first-page Nearby/Text search keys across batches (not pagination tokens). */
  seenSearchKeys?: string[]
  /** How many geo-center offset expansions have run (cap runaway growth). */
  radiusExpansionRuns?: number
}

type SearchPoint = { area: string; lat: number; lng: number }
type PlaceResult = {
  place_id?: string
  name?: string
  vicinity?: string
  formatted_address?: string
  /** Present only on some Text Search responses; skips a Place Details call when set. */
  website?: string
  rating?: number
  geometry?: { location: { lat: number; lng: number } }
}

type CampaignCtx = {
  campaignId: string
  userId: string
  niche: string
  location: string
  leadCap: number
}

type GenCtx = { mode: "campaign"; campaignId: string }

async function scraperDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

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

async function safeJson<T = unknown>(res: Response | null): Promise<T | null> {
  if (!res) return null
  try {
    return (await res.json()) as T
  } catch {
    console.log("JSON parse failed, skipping")
    return null
  }
}

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

async function trimLeadRowsToCap(
  supabase: SupabaseClient,
  campaignId: string,
  cap: number
): Promise<void> {
  const q = supabase
    .from("leads")
    .select("id")
    .order("id", { ascending: true })
    .eq("campaign_id", campaignId)
  const { data, error } = await q
  if (error || !data || data.length <= cap) return
  const excess = data.slice(cap)
  for (const r of excess) {
    await supabase.from("leads").delete().eq("id", r.id as string)
  }
  if (excess.length > 0) {
    console.log(`[scrape-batch] trimmed ${excess.length} excess rows to cap ${cap}`)
  }
}

async function getLeadCount(
  supabase: SupabaseClient,
  campaignId: string
): Promise<number> {
  const { count } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
  return count ?? 0
}

function buildMultiQueryVariations(nicheStr: string, locationStr: string): string[] {
  const n = nicheStr.trim()
  const l = locationStr.trim()
  return [`${n} ${l}`, `${n} company ${l}`, `${n} services ${l}`, `${n} near ${l}`, `best ${n} ${l}`]
}

function buildBroadenedQueries(nicheStr: string, locationStr: string): string[] {
  const n = nicheStr.trim()
  const l = locationStr.trim()
  const firstToken = n.split(/\s+/)[0] || n
  return [`${l} businesses`, `${firstToken} ${l}`, l]
}

async function runHunterFallbackChunk(
  supabase: SupabaseClient,
  genCtx: GenCtx,
  TARGET: number,
  maxUpdatesThisCall: number,
  checkpoint: CampaignScrapeCheckpoint
): Promise<number> {
  let emailsFound = await countEmailLeadsForContext(supabase, genCtx)
  if (!process.env.HUNTER_IO_API_KEY?.trim()) {
    return emailsFound
  }
  if (emailsFound >= TARGET) return emailsFound

  const missing = TARGET - emailsFound
  const q = supabase
    .from("leads")
    .select("id, email, website")
    .order("id", { ascending: true })
    .eq("campaign_id", genCtx.campaignId)

  const { data: allLeads, error } = await q
  if (error || !allLeads) return emailsFound

  const leadsWithoutEmail = allLeads
    .filter((l) => {
      const e = typeof l.email === "string" ? l.email.trim() : ""
      return !e || !isEmailAllowedForCampaignQueue(e)
    })
    .filter((l) => domainFromWebsiteUrl((l.website as string) ?? null))
    .slice(0, missing)

  let updates = 0
  for (let i = 0; i < leadsWithoutEmail.length; i += BATCH_SIZE) {
    if (emailsFound >= TARGET) break
    if (updates >= maxUpdatesThisCall) break

    const batch = leadsWithoutEmail.slice(i, i + BATCH_SIZE)
    const enrichedResults: { lead: (typeof allLeads)[0]; enriched: string | null }[] = []
    for (const lead of batch) {
      const domain = domainFromWebsiteUrl((lead.website as string) ?? null)
      if (!domain) {
        enrichedResults.push({ lead, enriched: null })
        continue
      }
      const used = checkpoint.hunterCallsUsed ?? 0
      if (used >= MAX_HUNTER_DOMAIN_LOOKUPS_PER_CAMPAIGN_SCRAPE) {
        enrichedResults.push({ lead, enriched: null })
        continue
      }
      checkpoint.hunterCallsUsed = used + 1
      let enriched: string | null = null
      try {
        enriched = await enrichEmail(domain)
      } catch {
        enriched = null
      }
      enrichedResults.push({ lead, enriched })
    }

    for (const { lead, enriched } of enrichedResults) {
      if (updates >= maxUpdatesThisCall) break
      if (emailsFound >= TARGET) break
      if (!enriched) continue

      const { error: upErr } = await supabase
        .from("leads")
        .update({ email: enriched, guessed_email: null })
        .eq("id", lead.id as string)

      if (!upErr) {
        emailsFound++
        updates++
        await ensureInitialCampaignMessageForLead(
          supabase,
          genCtx.campaignId,
          lead.id as string
        )
      }
    }
  }

  return await countEmailLeadsForContext(supabase, genCtx)
}

export async function prepareCampaignScrapeCheckpoint(params: {
  supabase: SupabaseClient
  ctx: CampaignCtx
  apiKey: string
  storedCampaignCoords?: { lat: number; lng: number } | null
  /** Return false to skip the upcoming Google HTTP call (budget exhausted). */
  beforeGoogleMapsCall?: () => boolean
}): Promise<CampaignScrapeCheckpoint> {
  const { supabase, ctx, apiKey, storedCampaignCoords, beforeGoogleMapsCall } = params
  const niche = ctx.niche
  const location = ctx.location

  async function gatedSafeFetch(url: string, options: RequestInit = {}): Promise<Response | null> {
    if (beforeGoogleMapsCall && !beforeGoogleMapsCall()) return null
    return safeFetch(url, options)
  }

  let primaryTarget: GeocodedTarget | null = null

  if (storedCampaignCoords) {
    primaryTarget = await reverseGeocodeToTarget(
      storedCampaignCoords.lat,
      storedCampaignCoords.lng,
      location,
      apiKey,
      gatedSafeFetch,
      safeJson
    )
    if (primaryTarget) {
      console.log("Using location-based search")
    }
  }

  if (!primaryTarget) {
    primaryTarget = await geocodeAddressToTarget(location, apiKey, gatedSafeFetch, safeJson)
    if (primaryTarget) {
      console.log(`Geocoded city → ${primaryTarget.lat},${primaryTarget.lng}`)
    }
  }

  if (!primaryTarget) {
    throw new Error("Could not geocode target location")
  }

  await supabase
    .from("campaigns")
    .update({
      location_lat: primaryTarget.lat,
      location_lng: primaryTarget.lng,
    })
    .eq("id", ctx.campaignId)
    .eq("user_id", ctx.userId)

  const aiExtraAreas = await expandLocationsWithAI(location, niche)
  const searchAreaStrings = mergeSearchAreaStringLists(
    buildAllSearchAreaStrings(location),
    aiExtraAreas
  ).slice(0, MAX_SEARCH_AREA_STRINGS)

  const geocodedExpansion: SearchPoint[] = []
  for (let off = 0; off < searchAreaStrings.length; off += GEOCODE_BATCH_SIZE) {
    const chunk = searchAreaStrings.slice(off, off + GEOCODE_BATCH_SIZE)
    const geoResults = await Promise.all(
      chunk.map(async (area) => {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(area)}&key=${apiKey}`
        const res = await gatedSafeFetch(url)
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

  const rawKeywordVariants = await buildPlacesKeywordVariants(niche)
  const searchKeywords = (rawKeywordVariants.length ? rawKeywordVariants : [niche]).slice(
    0,
    MAX_KEYWORD_VARIANTS
  )

  console.log(
    `[scrape-batch] prepared checkpoint: anchor ${primaryTarget.lat.toFixed(4)},${primaryTarget.lng.toFixed(4)} | ${searchPoints.length} centers | ${searchKeywords.length} keywords`
  )

  return {
    v: 1,
    niche,
    location,
    primaryTarget,
    searchPoints,
    searchKeywords,
    wave: 0,
    consecutiveEmptyWaves: 0,
    campaignGeoOffsetIdx: 0,
    rawBusinessesSeen: 0,
    stopCollecting: false,
    pageState: {},
    pi: 0,
    r: 0,
    ki: 0,
    nearbyInnerPageNum: 0,
    campaignPlaceBuffer: [],
    savedThisWavePlaceIds: [],
    collectPhase: "nearby_waves",
    textRi: 0,
    textQueryIdx: 0,
    textQueries: [],
    textPageToken: null,
    textPageNum: 0,
    postPhase: "none",
    contactFetchOffset: 0,
    seenSearchKeys: [],
    radiusExpansionRuns: 0,
  }
}

async function fetchWebsiteAndEmailForPlace(
  placeId: string,
  apiKey: string,
  opts?: {
    /** When set, skips Place Details (list response already had a website URL). */
    knownWebsite?: string | null
    /** Invoked immediately before a Place Details HTTP request; return false to skip the request. */
    beforeDetailCall?: () => boolean
    /** When true, skip Place Details HTTP (save cost after many list/geocode calls). */
    skipPlaceDetails?: () => boolean
    /** Async: reserve one Hunter lookup (serialized under parallel enrich workers). */
    reserveHunterSlot?: () => Promise<boolean>
  }
): Promise<{
  website: string | null
  email: string | null
  guessedEmail: string | null
  phone: string | null
}> {
  const signal = AbortSignal.timeout(ENRICH_LEAD_TIMEOUT_MS)
  try {
    let website: string | null = opts?.knownWebsite?.trim() ? opts.knownWebsite.trim() : null
    let phone: string | null = null

    if (!website) {
      if (opts?.skipPlaceDetails?.()) {
        console.log("[LIMIT] Skipping details (cost control)")
        return { website: null, email: null, guessedEmail: null, phone: null }
      }
      if (opts?.beforeDetailCall && !opts.beforeDetailCall()) {
        return { website: null, email: null, guessedEmail: null, phone: null }
      }
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
        placeId
      )}&fields=website,formatted_phone_number&key=${apiKey}`
      const res = await fetch(detailsUrl, { signal })
      if (!res.ok) return { website: null, email: null, guessedEmail: null, phone: null }
      const details = (await res.json()) as {
        result?: { website?: string; formatted_phone_number?: string }
      }

      website = details.result?.website ?? null
      const phoneRaw = details.result?.formatted_phone_number?.trim() ?? ""
      phone = phoneRaw.length > 0 ? phoneRaw : null
    }

    let email: string | null = null
    let guessedEmail: string | null = null
    if (website?.trim()) {
      const r = await scrapeEmailFromWebsite(website, signal)
      email = r.email
      guessedEmail = r.guessedEmail
    }

    const domain = domainFromWebsiteUrl(website)
    if (!email && domain) {
      const mayHunter = opts?.reserveHunterSlot
        ? await opts.reserveHunterSlot()
        : true
      if (mayHunter) {
        const hunter = await enrichEmail(domain)
        if (hunter && isEmailAllowedForCampaignQueue(hunter)) {
          email = hunter
        }
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

export type ScrapeBatchResult = {
  ok: boolean
  skipped?: boolean
  error?: string
  scrapedThisBatch: number
  totalLeadsNow: number
  emailLeadsNow: number
  done: boolean
  leadCap: number
  phase: string
}

export async function runCampaignScrapeBatch(params: {
  supabase: SupabaseClient
  campaignId: string
  userId: string
  apiKey: string
  insertBudget?: number
}): Promise<ScrapeBatchResult> {
  const MAX_API_CALLS = MAX_GOOGLE_MAPS_API_CALLS_PER_CAMPAIGN_SCRAPE
  /** Reserve trailing calls for list/search pagination; fewer skips → more emails (Places Details kept longer). */
  const skipDetailsAfterCalls = MAX_API_CALLS - 14
  const apiCallsRef = { current: 0 }
  const enrichQueue: PlaceResult[] = []
  let enrichProducersDone = false
  try {
  const { supabase, campaignId, userId, apiKey } = params
  const insertBudget = params.insertBudget ?? SCRAPE_BATCH_INSERT_BUDGET

  console.log("[batch] campaignId:", campaignId)

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "id, user_id, status, target_search_query, lead_generation_status, scrape_checkpoint, location_lat, location_lng"
    )
    .eq("id", campaignId)
    .eq("user_id", userId)
    .maybeSingle()

  if (cErr) {
    console.error("[batch] campaign fetch error:", cErr.message)
    return {
      ok: false,
      error: "Campaign not found",
      scrapedThisBatch: 0,
      totalLeadsNow: 0,
      emailLeadsNow: 0,
      done: true,
      leadCap: MAX_LEADS,
      phase: "error",
    }
  }

  if (!campaign) {
    console.warn("[batch] campaign row missing (RLS or wrong id/user)")
    return {
      ok: false,
      error: "Campaign not found",
      scrapedThisBatch: 0,
      totalLeadsNow: 0,
      emailLeadsNow: 0,
      done: true,
      leadCap: MAX_LEADS,
      phase: "error",
    }
  }

  if ((campaign.user_id as string) !== userId) {
    return { ok: false, error: "Unauthorized", scrapedThisBatch: 0, totalLeadsNow: 0, emailLeadsNow: 0, done: true, leadCap: MAX_LEADS, phase: "error" }
  }

  if ((campaign as { status?: string }).status === "completed") {
    console.log("[STOP] Campaign already completed")
    const totalLeadsNow = await getLeadCount(supabase, campaignId)
    const emailLeadsNow = await countEmailLeadsForContext(supabase, {
      mode: "campaign",
      campaignId,
    })
    return {
      ok: true,
      skipped: true,
      scrapedThisBatch: 0,
      totalLeadsNow,
      emailLeadsNow,
      done: true,
      leadCap: MAX_LEADS,
      phase: "completed",
    }
  }

  const lg = campaign.lead_generation_status as string | null
  if (lg !== "generating") {
    const totalLeadsNow = await getLeadCount(supabase, campaignId)
    const emailLeadsNow = await countEmailLeadsForContext(supabase, {
      mode: "campaign",
      campaignId,
    })
    return {
      ok: true,
      skipped: true,
      scrapedThisBatch: 0,
      totalLeadsNow,
      emailLeadsNow,
      done: true,
      leadCap: MAX_LEADS,
      phase: lg ?? "idle",
    }
  }

  const searchQuery = (campaign.target_search_query as string) || ""
  const { niche, location } = await parseSearchQuery(searchQuery)

  const leadCap = Math.min(MAX_LEADS, SCRAPE_POLICY.maxLeadsPerScrape)

  const latRaw = campaign.location_lat as number | string | null | undefined
  const lngRaw = campaign.location_lng as number | string | null | undefined
  const lat = typeof latRaw === "number" ? latRaw : latRaw != null ? Number(latRaw) : NaN
  const lng = typeof lngRaw === "number" ? lngRaw : lngRaw != null ? Number(lngRaw) : NaN
  const storedCampaignCoords =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null

  let checkpoint: CampaignScrapeCheckpoint
  const checkpointFromDb = campaign.scrape_checkpoint as CampaignScrapeCheckpoint | null
  if (!checkpointFromDb || checkpointFromDb.v !== 1) {
    try {
      const beforePrepGoogle = (): boolean => consumeGoogleMapsApiSlot(apiCallsRef, MAX_API_CALLS)
      const prepared = await prepareCampaignScrapeCheckpoint({
        supabase,
        ctx: {
          campaignId,
          userId,
          niche,
          location,
          leadCap,
        },
        apiKey,
        storedCampaignCoords,
        beforeGoogleMapsCall: beforePrepGoogle,
      })
      prepared.apiCalls = apiCallsRef.current
      const { error: cpSaveErr } = await supabase
        .from("campaigns")
        .update({
          scrape_checkpoint: prepared as unknown as Record<string, unknown>,
          lead_generation_status: "generating",
          lead_generation_stage: "searching",
        })
        .eq("id", campaignId)
        .eq("user_id", userId)

      if (cpSaveErr) {
        console.error("[scrape-batch] checkpoint init save failed:", cpSaveErr)
        await supabase
          .from("campaigns")
          .update({ lead_generation_status: "failed" })
          .eq("id", campaignId)
          .eq("user_id", userId)
        return {
          ok: false,
          error: "Could not initialize scrape checkpoint",
          scrapedThisBatch: 0,
          totalLeadsNow: await getLeadCount(supabase, campaignId),
          emailLeadsNow: 0,
          done: true,
          leadCap,
          phase: "init_failed",
        }
      }
      checkpoint = prepared
    } catch (err) {
      console.error("[scrape-batch] checkpoint init failed:", err)
      await supabase
        .from("campaigns")
        .update({ lead_generation_status: "failed" })
        .eq("id", campaignId)
        .eq("user_id", userId)
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not geocode target location. Try a more specific city or region.",
        scrapedThisBatch: 0,
        totalLeadsNow: await getLeadCount(supabase, campaignId),
        emailLeadsNow: 0,
        done: true,
        leadCap,
        phase: "init_failed",
      }
    }
  } else {
    checkpoint = checkpointFromDb
    if ((checkpoint as { postPhase?: string }).postPhase === "contact_fetch") {
      checkpoint.postPhase = "hunter_trim"
    }
  }
  apiCallsRef.current = checkpoint.apiCalls ?? 0
  const seenQueries = new Set<string>(checkpoint.seenSearchKeys ?? [])
  const persistSeenSearchKeys = () => {
    checkpoint.seenSearchKeys = [...seenQueries].slice(-800)
  }
  const ctx: CampaignCtx = {
    campaignId,
    userId,
    niche,
    location,
    leadCap,
  }

  const genCtx: GenCtx = { mode: "campaign", campaignId }
  let emailLeadsInCampaign = await countEmailLeadsForContext(supabase, genCtx)

  /** When DB lacks `leads_found`/`emails_found` (or PostgREST schema cache is stale), stop hammering Supabase every lead. */
  let campaignCounterSyncDisabled = false
  let counterSyncWarned = false

  function counterColumnsLikelyMissing(message: string): boolean {
    const m = message.toLowerCase()
    return (
      m.includes("schema cache") ||
      m.includes("leads_found") ||
      m.includes("emails_found") ||
      m.includes("pgrst204") ||
      m.includes("could not find")
    )
  }

  let counterSyncDebounce: ReturnType<typeof setTimeout> | null = null
  let pendingCounterPayload: { leads_found: number; emails_found: number } | null = null

  async function updateCampaignLeadCounters(
    payload: { leads_found: number; emails_found: number },
    logPrefix: string
  ): Promise<void> {
    if (campaignCounterSyncDisabled) return

    const { error } = await supabase
      .from("campaigns")
      .update(payload)
      .eq("id", campaignId)
      .eq("user_id", userId)

    if (!error) return

    const msg = String(error.message ?? "")
    if (msg.includes("emails_found") || msg.includes("leads_found")) {
      const { error: fallbackErr } = await supabase
        .from("campaigns")
        .update({ leads_found: payload.leads_found })
        .eq("id", campaignId)
        .eq("user_id", userId)
      if (!fallbackErr) return
      const fb = String(fallbackErr.message ?? "")
      if (counterColumnsLikelyMissing(msg) || counterColumnsLikelyMissing(fb)) {
        campaignCounterSyncDisabled = true
        if (!counterSyncWarned) {
          counterSyncWarned = true
          console.warn(
            `${logPrefix} disabled — campaigns.leads_found / emails_found not available (run Supabase migrations or reload schema). Live lead counts still come from the leads table + Realtime.`
          )
        }
        return
      }
      console.log(`${logPrefix} (fallback leads_found only):`, fb)
      return
    }

    if (counterColumnsLikelyMissing(msg)) {
      campaignCounterSyncDisabled = true
      if (!counterSyncWarned) {
        counterSyncWarned = true
        console.warn(
          `${logPrefix} disabled — ${msg}. Apply migrations or reload schema; skipping further counter writes this run.`
        )
      }
      return
    }

    console.log(logPrefix, error.message)
  }

  function scheduleCampaignCounterSync(totalLeads: number, emailCount: number): void {
    if (campaignCounterSyncDisabled) return
    pendingCounterPayload = {
      leads_found: totalLeads,
      emails_found: emailCount,
    }
    if (counterSyncDebounce) return
    counterSyncDebounce = setTimeout(() => {
      counterSyncDebounce = null
      const p = pendingCounterPayload
      pendingCounterPayload = null
      if (!p || campaignCounterSyncDisabled) return
      void updateCampaignLeadCounters(p, "[scrape] campaigns leads_found/emails_found update:")
    }, 450)
  }

  async function maybeSyncCampaignUI(totalLeads: number, emailCount: number): Promise<void> {
    scheduleCampaignCounterSync(totalLeads, emailCount)
  }

  let hasMarkedEnriching = false
  async function maybeSetEnrichingStatus(leadCount: number): Promise<void> {
    if (hasMarkedEnriching) return
    if (leadCount < leadCap) return
    hasMarkedEnriching = true
    const { error } = await supabase
      .from("campaigns")
      .update({ status: "enriching" })
      .eq("id", campaignId)
      .eq("user_id", userId)
    if (error) {
      console.log("[scrape] status→enriching", error.message)
    }
  }

  {
    const n0 = await getLeadCount(supabase, campaignId)
    void maybeSetEnrichingStatus(n0)
  }

  async function scrapeCampaignStatusTerminal(): Promise<boolean> {
    const { data } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .eq("user_id", userId)
      .maybeSingle()
    return (data?.status as string | undefined) === "completed"
  }

  async function maybeHardCapLeads(totalLeadsNow: number): Promise<void> {
    if (totalLeadsNow < leadCap) return
    console.log("[DONE] Lead cap reached")
    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaignId).eq("user_id", userId)
    checkpoint.stopCollecting = true
    checkpoint.collectPhase = "collection_done"
    enrichProducersDone = true
  }

  async function assertCampaignExists(): Promise<boolean> {
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("user_id", userId)
      .maybeSingle()
    return !!data
  }

  async function reloadDedupe(): Promise<{
    seenPlaceIds: Set<string>
    seenNameAddressKeys: Set<string>
    seenContactKeys: Set<string>
  }> {
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("place_id, name, address, website, email")
      .eq("campaign_id", campaignId)

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
    return { seenPlaceIds, seenNameAddressKeys, seenContactKeys }
  }

  let scrapedThisBatch = 0
  let primaryTarget = checkpoint.primaryTarget

  function consumeGoogleApiCall(): boolean {
    if (apiCallsRef.current >= MAX_API_CALLS) {
      console.log("[STOP] API cap reached - finishing early")
      checkpoint.apiBudgetExhausted = true
      checkpoint.stopCollecting = true
      return false
    }
    const ok = consumeGoogleMapsApiSlot(apiCallsRef, MAX_API_CALLS)
    if (!ok) {
      checkpoint.apiBudgetExhausted = true
      checkpoint.stopCollecting = true
      return false
    }
    checkpoint.apiCalls = apiCallsRef.current
    return true
  }

  const safePlacesHttp = safeGoogleCall(apiCallsRef, MAX_API_CALLS, (u: string) => safeFetch(u))

  async function googlePlacesFetch(url: string): Promise<Response | null> {
    if (apiCallsRef.current >= MAX_API_CALLS) {
      checkpoint.apiBudgetExhausted = true
      checkpoint.stopCollecting = true
      return null
    }
    const before = apiCallsRef.current
    const res = await safePlacesHttp(url)
    if (res === null && apiCallsRef.current === before) {
      checkpoint.apiBudgetExhausted = true
      checkpoint.stopCollecting = true
    }
    checkpoint.apiCalls = apiCallsRef.current
    return res
  }

  /** Serialize Hunter budget checks — enrich worker runs parallel batches of 5. */
  let hunterReservePending = Promise.resolve<boolean>(true)

  async function reserveHunterSlot(): Promise<boolean> {
    const run = hunterReservePending.then((): boolean => {
      const u = checkpoint.hunterCallsUsed ?? 0
      if (u >= MAX_HUNTER_DOMAIN_LOOKUPS_PER_CAMPAIGN_SCRAPE) return false
      checkpoint.hunterCallsUsed = u + 1
      return true
    })
    hunterReservePending = run.then(
      () => true,
      () => true
    )
    return run
  }

  async function runEnrichWorker() {
    const w = 7
    let enrichIterations = 0
    while (true) {
      enrichIterations++
      if (enrichIterations > 250_000) {
        console.log("[STOP] enrich worker iteration cap")
        break
      }
      if (enrichIterations % 120 === 0 && (await scrapeCampaignStatusTerminal())) {
        console.log("[STOP] Campaign already completed")
        break
      }
      if (enrichQueue.length === 0) {
        if (enrichProducersDone) break
        await scraperDelay(20)
        continue
      }
      if (await scrapeCampaignStatusTerminal()) {
        console.log("[STOP] Campaign already completed")
        break
      }
      const batch = enrichQueue.splice(0, w)
      await Promise.all(
        batch.map(async (place) => {
          if (!place.place_id) return
          const { website, email, guessedEmail, phone } = await fetchWebsiteAndEmailForPlace(
            place.place_id,
            apiKey,
            {
              knownWebsite: place.website,
              beforeDetailCall: consumeGoogleApiCall,
              skipPlaceDetails: () => apiCallsRef.current > skipDetailsAfterCalls,
              reserveHunterSlot,
            }
          )
          let emailOut = email
          const siteForHtml = (website?.trim() || place.website?.trim()) ?? ""
          if (!emailOut?.trim() && siteForHtml) {
            try {
              const u = normalizeWebsiteUrl(siteForHtml)
              const htmlRes = await fetch(u, { signal: AbortSignal.timeout(8000) })
              if (htmlRes.ok) {
                const pageHtml = await htmlRes.text()
                const match = pageHtml.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
                if (match?.[0] && isEmailAllowedForCampaignQueue(match[0])) {
                  emailOut = match[0]
                }
              }
            } catch {
              /* cheap fallback — ignore */
            }
          }
          if (!website?.trim() && !emailOut?.trim() && !guessedEmail?.trim() && !phone?.trim()) return
          const em = emailOut && isEmailAllowedForCampaignQueue(emailOut) ? emailOut : null
          const updatePayload: Record<string, unknown> = {
            website: website || null,
            email: em,
            guessed_email: em && guessedEmail && guessedEmail === em ? guessedEmail : null,
          }
          if (phone) updatePayload.phone = phone
          const { data: updatedLead, error } = await supabase
            .from("leads")
            .update(updatePayload)
            .eq("campaign_id", campaignId)
            .eq("place_id", place.place_id)
            .eq("user_id", userId)
            .select("id")
            .maybeSingle()
          if (error) {
            console.log("[enrich-worker] update", error.message)
            return
          }
          if (em && updatedLead?.id) {
            await ensureInitialCampaignMessageForLead(
              supabase,
              campaignId,
              updatedLead.id as string
            )
          }
          if (em) {
            emailLeadsInCampaign++
            const n = await getLeadCount(supabase, campaignId)
            void maybeSyncCampaignUI(n, emailLeadsInCampaign)
          }
        })
      )
    }
  }
  void runEnrichWorker().catch((e) => console.error("[enrich-worker]", e))

  function tryStopCampaignScrape(
    leadsCollected: number,
    rawSeen: number,
    stopFlag: boolean
  ): boolean {
    if (stopFlag) return true
    if (leadsCollected >= leadCap) return true
    if (rawSeen >= SMART_STOP_MAX_BUSINESSES_SCANNED) return true
    return false
  }

  async function flushBufferChunk(
    buf: PlaceResult[],
    dedupe: {
      seenPlaceIds: Set<string>
      seenNameAddressKeys: Set<string>
      seenContactKeys: Set<string>
    }
  ): Promise<number> {
    if (buf.length === 0) return 0
    let inserted = 0
    const chunk = buf.splice(0, BATCH_SIZE)
    let leadsCollected = await getLeadCount(supabase, campaignId)

    for (const place of chunk) {
      if (scrapedThisBatch >= insertBudget) break
      if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) break
      if (!place.place_id) continue

      const w = place.website?.trim() ? place.website.trim() : null
      const row: LeadRowInput = {
        user_id: ctx.userId,
        name: place.name,
        company: place.name,
        address: place.vicinity || place.formatted_address || null,
        google_rating: place.rating ?? null,
        status: "pending",
        place_id: place.place_id,
        website: w,
        phone: null,
        email: null,
        guessed_email: null,
      }

      const ins = await insertOneCampaignLeadIfUnderCap(
        supabase,
        campaignId,
        row,
        leadCap,
        leadsCollected,
        dedupe.seenContactKeys
      )
      if (ins) {
        inserted++
        scrapedThisBatch++
        leadsCollected++
        void maybeSyncCampaignUI(leadsCollected, emailLeadsInCampaign)
        void maybeSetEnrichingStatus(leadsCollected)
        enrichQueue.push(place)
        console.log(`Scraped ${scrapedThisBatch} leads`)
        console.log(`Total leads now: ${leadsCollected}`)
        await maybeHardCapLeads(leadsCollected)
      }
    }
    return inserted
  }

  async function ingestTextSearchPlaces(
    places: PlaceResult[],
    dedupe: {
      seenPlaceIds: Set<string>
      seenNameAddressKeys: Set<string>
      seenContactKeys: Set<string>
    }
  ): Promise<void> {
    let batch = [...places]
    let ingestIterations = 0
    while (batch.length > 0 && scrapedThisBatch < insertBudget) {
      ingestIterations++
      if (ingestIterations > 10_000) {
        console.log("[STOP] ingest iterations cap")
        return
      }
      if (await scrapeCampaignStatusTerminal()) {
        console.log("[STOP] Campaign already completed")
        checkpoint.stopCollecting = true
        return
      }
      if (!(await assertCampaignExists())) {
        checkpoint.stopCollecting = true
        return
      }

      let leadsCollected = await getLeadCount(supabase, campaignId)
      if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) return

      const slice = batch.splice(0, BATCH_SIZE)
      for (const place of slice) {
        if (scrapedThisBatch >= insertBudget) return
        leadsCollected = await getLeadCount(supabase, campaignId)
        if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) return
        if (!place.place_id) continue

        const w = place.website?.trim() ? place.website.trim() : null
        const row: LeadRowInput = {
          user_id: ctx.userId,
          name: place.name,
          company: place.name,
          address: place.vicinity || place.formatted_address || null,
          google_rating: place.rating ?? null,
          status: "pending",
          place_id: place.place_id,
          website: w,
          phone: null,
          email: null,
          guessed_email: null,
        }
        const ins = await insertOneCampaignLeadIfUnderCap(
          supabase,
          campaignId,
          row,
          leadCap,
          leadsCollected,
          dedupe.seenContactKeys
        )
        if (ins) {
          scrapedThisBatch++
          leadsCollected++
          void maybeSyncCampaignUI(leadsCollected, emailLeadsInCampaign)
          void maybeSetEnrichingStatus(leadsCollected)
          enrichQueue.push(place)
          console.log(`Scraped ${scrapedThisBatch} leads`)
          console.log(`Total leads now: ${leadsCollected}`)
          await maybeHardCapLeads(leadsCollected)
        }
      }
    }
  }

  function collectTextSearchNewCandidates(
    results: PlaceResult[],
    dedupe: { seenPlaceIds: Set<string>; seenNameAddressKeys: Set<string> }
  ): PlaceResult[] {
    const out: PlaceResult[] = []
    const target = primaryTarget
    if (!target) return out
    for (const place of results) {
      if (checkpoint.rawBusinessesSeen >= MAX_RAW_BUSINESSES) break
      checkpoint.rawBusinessesSeen++
      const placeId = place.place_id
      if (!placeId) continue
      const addrPart = (place.vicinity || place.formatted_address || "").slice(0, 48).toLowerCase()
      const naKey = `${(place.name || "").toLowerCase().trim()}|${addrPart}`
      if (dedupe.seenPlaceIds.has(placeId)) continue
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
      if (dedupe.seenNameAddressKeys.has(naKey)) continue
      dedupe.seenNameAddressKeys.add(naKey)
      dedupe.seenPlaceIds.add(placeId)
      out.push(place)
    }
    return out
  }

  const dedupeReload = await reloadDedupe()
  let globalDedupe: typeof dedupeReload = dedupeReload

  /** ---------- Nearby waves ---------- */
  if (checkpoint.postPhase === "none" && checkpoint.collectPhase === "nearby_waves") {
    while (scrapedThisBatch < insertBudget && !checkpoint.stopCollecting) {
      if (await scrapeCampaignStatusTerminal()) {
        console.log("[STOP] Campaign already completed")
        checkpoint.stopCollecting = true
        break
      }
      if (!(await assertCampaignExists())) {
        checkpoint.stopCollecting = true
        break
      }

      globalDedupe = await reloadDedupe()
      let leadsCollected = await getLeadCount(supabase, campaignId)
      if (leadsCollected >= leadCap) {
        checkpoint.collectPhase = "collection_done"
        checkpoint.stopCollecting = true
        break
      }
      if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) {
        checkpoint.stopCollecting = true
        break
      }

      const waveScrapedStart = scrapedThisBatch
      checkpoint.wave++

      let appendedGeoCenter = false
      const MAX_RADIUS_EXPANSION_RUNS = 2
      const radiusRuns = checkpoint.radiusExpansionRuns ?? 0
      if (
        !checkpoint.stopCollecting &&
        checkpoint.campaignGeoOffsetIdx < CAMPAIGN_NEARBY_OFFSET_DEG.length &&
        checkpoint.wave > 1
      ) {
        if (radiusRuns >= MAX_RADIUS_EXPANSION_RUNS) {
          console.log("[STOP] Radius expansion capped")
          checkpoint.campaignGeoOffsetIdx = CAMPAIGN_NEARBY_OFFSET_DEG.length
        } else {
          checkpoint.radiusExpansionRuns = radiusRuns + 1
          const o = CAMPAIGN_NEARBY_OFFSET_DEG[checkpoint.campaignGeoOffsetIdx]
          checkpoint.campaignGeoOffsetIdx++
          const nlat = primaryTarget.lat + o.lat
          const nlng = primaryTarget.lng + o.lng
          const exists = checkpoint.searchPoints.some(
            (p) => Math.abs(p.lat - nlat) < 1e-4 && Math.abs(p.lng - nlng) < 1e-4
          )
          if (!exists) {
            checkpoint.searchPoints.push({
              area: `${primaryTarget.label} (nearby +${o.lat}, ${o.lng})`,
              lat: nlat,
              lng: nlng,
            })
            appendedGeoCenter = true
          }
        }
      }

      await supabase
        .from("campaigns")
        .update({
          lead_generation_stage:
            checkpoint.wave === 1 ? "searching" : appendedGeoCenter ? "expanding" : "searching",
        })
        .eq("id", campaignId)
        .eq("user_id", userId)

      outer: while (
        checkpoint.pi < checkpoint.searchPoints.length &&
        scrapedThisBatch < insertBudget &&
        !checkpoint.stopCollecting
      ) {
        const point = checkpoint.searchPoints[checkpoint.pi]

        innerR: while (
          checkpoint.r < Math.min(RADIUS_STEPS.length, MAX_RADIUS_STEPS) &&
          scrapedThisBatch < insertBudget &&
          !checkpoint.stopCollecting
        ) {
          const radius = RADIUS_STEPS[checkpoint.r]

          innerK: while (
            checkpoint.ki < checkpoint.searchKeywords.length &&
            scrapedThisBatch < insertBudget &&
            !checkpoint.stopCollecting
          ) {
            const keyword = checkpoint.searchKeywords[checkpoint.ki]
            const pageKey = `${checkpoint.pi}|${checkpoint.r}|${checkpoint.ki}`

            paginate: while (!checkpoint.stopCollecting && scrapedThisBatch < insertBudget) {
              if (await scrapeCampaignStatusTerminal()) {
                console.log("[STOP] Campaign already completed")
                checkpoint.stopCollecting = true
                break outer
              }
              if (!(await assertCampaignExists())) {
                checkpoint.stopCollecting = true
                break outer
              }

              leadsCollected = await getLeadCount(supabase, campaignId)
              if (leadsCollected >= leadCap) {
                checkpoint.collectPhase = "collection_done"
                checkpoint.stopCollecting = true
                break outer
              }
              if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) {
                checkpoint.stopCollecting = true
                break outer
              }

              const requestToken = checkpoint.pageState[pageKey] ?? null

              if (!requestToken) {
                checkpoint.nearbyInnerPageNum = 0
              } else {
                await scraperDelay(PAGE_TOKEN_DELAY_MS)
              }

              if (!requestToken) {
                const queryKey = `${keyword}-${point.lat}-${point.lng}-${radius}`
                if (seenQueries.has(queryKey)) {
                  console.log("[SKIP] Duplicate query:", queryKey)
                  break paginate
                }
                seenQueries.add(queryKey)
                persistSeenSearchKeys()
              }

              const url = !requestToken
                ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${point.lat},${point.lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${apiKey}`
                : `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${requestToken}&key=${apiKey}`

              const res = await googlePlacesFetch(url)
              if (res === null && apiCallsRef.current >= MAX_API_CALLS) {
                console.log("[STOP] API cap reached - finishing early")
                break paginate
              }
              const data = await safeJson<{
                results?: PlaceResult[]
                error_message?: string
                next_page_token?: string
              }>(res)
              if (!data || data.error_message) {
                if (data?.error_message) console.error("Places API error:", data.error_message)
                checkpoint.pageState[pageKey] = null
                break paginate
              }

              const results = data.results || []
              checkpoint.rawBusinessesSeen += results.length

              const nextToken = data.next_page_token ?? null
              checkpoint.pageState[pageKey] = nextToken

              globalDedupe = await reloadDedupe()

              const seenPlaceIdsThisPage = new Set<string>()
              for (const place of results) {
                if (scrapedThisBatch >= insertBudget) break outer
                if (checkpoint.stopCollecting) break outer

                leadsCollected = await getLeadCount(supabase, campaignId)
                if (leadsCollected >= leadCap) {
                  checkpoint.collectPhase = "collection_done"
                  checkpoint.stopCollecting = true
                  break outer
                }
                if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) {
                  checkpoint.stopCollecting = true
                  break outer
                }

                const placeId = place.place_id
                if (!placeId) continue
                if (seenPlaceIdsThisPage.has(placeId)) continue
                seenPlaceIdsThisPage.add(placeId)
                if (globalDedupe.seenPlaceIds.has(placeId)) continue
                if (
                  !isNearbyPlaceInTargetRegion(place, { lat: point.lat, lng: point.lng }, radius, primaryTarget)
                ) {
                  continue
                }
                const addrPart = (place.vicinity || place.formatted_address || "").slice(0, 48).toLowerCase()
                const naKey = `${(place.name || "").toLowerCase().trim()}|${addrPart}`
                if (globalDedupe.seenNameAddressKeys.has(naKey)) continue
                globalDedupe.seenNameAddressKeys.add(naKey)
                globalDedupe.seenPlaceIds.add(placeId)

                checkpoint.campaignPlaceBuffer.push(place)

                while (
                  checkpoint.campaignPlaceBuffer.length >= BATCH_SIZE &&
                  scrapedThisBatch < insertBudget &&
                  !checkpoint.stopCollecting
                ) {
                  await flushBufferChunk(checkpoint.campaignPlaceBuffer, globalDedupe)
                  if (scrapedThisBatch >= insertBudget) break outer
                }
              }

              leadsCollected = await getLeadCount(supabase, campaignId)
              checkpoint.nearbyInnerPageNum++
              if (!nextToken) break paginate
              if (leadsCollected >= leadCap) break paginate
              if (checkpoint.nearbyInnerPageNum >= MAX_PLACE_PAGES_PER_SEARCH) break paginate
            }

            checkpoint.ki++
          }
          checkpoint.ki = 0
          checkpoint.r++
        }
        checkpoint.r = 0
        checkpoint.pi++
      }

      if (checkpoint.campaignPlaceBuffer.length > 0 && scrapedThisBatch < insertBudget) {
        globalDedupe = await reloadDedupe()
        let bufferFlushLoops = 0
        while (
          checkpoint.campaignPlaceBuffer.length > 0 &&
          scrapedThisBatch < insertBudget &&
          bufferFlushLoops < 5000
        ) {
          bufferFlushLoops++
          await flushBufferChunk(checkpoint.campaignPlaceBuffer, globalDedupe)
        }
        if (bufferFlushLoops >= 5000) {
          console.log("[STOP] buffer flush iteration cap")
          checkpoint.stopCollecting = true
        }
      }

      leadsCollected = await getLeadCount(supabase, campaignId)
      await maybeHardCapLeads(leadsCollected)
      const waveInserted = scrapedThisBatch - waveScrapedStart

      if (leadsCollected >= leadCap) {
        checkpoint.collectPhase = "collection_done"
        break
      }

      if (checkpoint.apiBudgetExhausted) {
        checkpoint.collectPhase = "collection_done"
        checkpoint.stopCollecting = false
        break
      }
      if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) {
        checkpoint.collectPhase = "text_search"
        checkpoint.textRi = 0
        checkpoint.textQueryIdx = 0
        checkpoint.textPageToken = null
        checkpoint.textPageNum = 0
        checkpoint.textQueries = buildMultiQueryVariations(niche, location)
        checkpoint.stopCollecting = false
        break
      }

      if (waveInserted === 0) {
        checkpoint.consecutiveEmptyWaves++
        if (checkpoint.consecutiveEmptyWaves >= MAX_CONSECUTIVE_EMPTY_WAVES) {
          checkpoint.collectPhase = "text_search"
          checkpoint.textRi = 0
          checkpoint.textQueryIdx = 0
          checkpoint.textPageToken = null
          checkpoint.textPageNum = 0
          checkpoint.textQueries = buildMultiQueryVariations(niche, location)
          break
        }
      } else {
        checkpoint.consecutiveEmptyWaves = 0
      }

      checkpoint.pi = 0
      checkpoint.r = 0
      checkpoint.ki = 0

      if (checkpoint.collectPhase !== "nearby_waves") break

      if (scrapedThisBatch >= insertBudget) break
    }
  }

  /** ---------- Text search ---------- */
  globalDedupe = await reloadDedupe()

  if (checkpoint.apiBudgetExhausted && checkpoint.collectPhase === "text_search") {
    checkpoint.collectPhase = "collection_done"
  }

  if (
    checkpoint.postPhase === "none" &&
    checkpoint.collectPhase === "text_search" &&
    !checkpoint.apiBudgetExhausted &&
    scrapedThisBatch < insertBudget
  ) {
    await supabase
      .from("campaigns")
      .update({ lead_generation_stage: "searching" })
      .eq("id", campaignId)
      .eq("user_id", userId)

    textOuter: for (; checkpoint.textRi < TEXT_SEARCH_BIAS_RADII_M.length; checkpoint.textRi++) {
      const radiusBias = TEXT_SEARCH_BIAS_RADII_M[checkpoint.textRi]
      const useBroadQueries = checkpoint.textRi > 0

      if (useBroadQueries && checkpoint.textQueries.length < 8) {
        checkpoint.textQueries = [
          ...buildMultiQueryVariations(niche, location),
          ...buildBroadenedQueries(niche, location),
        ]
      } else if (!useBroadQueries) {
        checkpoint.textQueries = buildMultiQueryVariations(niche, location)
      }

      for (; checkpoint.textQueryIdx < checkpoint.textQueries.length; checkpoint.textQueryIdx++) {
        const query = checkpoint.textQueries[checkpoint.textQueryIdx]

        while (scrapedThisBatch < insertBudget && !checkpoint.stopCollecting) {
          if (await scrapeCampaignStatusTerminal()) {
            console.log("[STOP] Campaign already completed")
            checkpoint.stopCollecting = true
            break textOuter
          }
          if (!(await assertCampaignExists())) {
            checkpoint.stopCollecting = true
            break textOuter
          }

          let leadsCollected = await getLeadCount(supabase, campaignId)
          if (leadsCollected >= leadCap || checkpoint.rawBusinessesSeen >= MAX_RAW_BUSINESSES) {
            checkpoint.collectPhase = "collection_done"
            break textOuter
          }
          await maybeHardCapLeads(leadsCollected)
          if (checkpoint.stopCollecting) break textOuter

          let url: string
          if (!checkpoint.textPageToken) {
            const queryKey = `${query}-${primaryTarget.lat}-${primaryTarget.lng}-${radiusBias}`
            if (seenQueries.has(queryKey)) {
              console.log("[SKIP] Duplicate query:", queryKey)
              checkpoint.textPageToken = null
              checkpoint.textPageNum = 0
              break
            }
            seenQueries.add(queryKey)
            persistSeenSearchKeys()
            url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
              query
            )}&location=${primaryTarget.lat},${primaryTarget.lng}&radius=${radiusBias}&key=${apiKey}`
          } else {
            await scraperDelay(PAGE_TOKEN_DELAY_MS)
            url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(
              checkpoint.textPageToken
            )}&key=${apiKey}`
          }

          const res = await googlePlacesFetch(url)
          if (res === null && apiCallsRef.current >= MAX_API_CALLS) {
            console.log("[STOP] API cap reached - finishing early")
            break
          }
          const data = await safeJson<{
            results?: PlaceResult[]
            next_page_token?: string
            error_message?: string
          }>(res)
          if (!data || data.error_message) {
            checkpoint.textPageToken = null
            checkpoint.textPageNum = 0
            break
          }

          const results = data.results ?? []
          globalDedupe = await reloadDedupe()
          const candidates = collectTextSearchNewCandidates(results, globalDedupe)
          await ingestTextSearchPlaces(candidates, globalDedupe)

          checkpoint.textPageToken = data.next_page_token ?? null
          checkpoint.textPageNum++
          if (!checkpoint.textPageToken) break
          if (checkpoint.textPageNum >= TEXT_SEARCH_MAX_PAGES_PER_QUERY) break

          leadsCollected = await getLeadCount(supabase, campaignId)
          if (leadsCollected >= leadCap) break textOuter
          if (scrapedThisBatch >= insertBudget) break textOuter
          await maybeHardCapLeads(leadsCollected)
          if (checkpoint.stopCollecting) break textOuter
        }

        checkpoint.textPageToken = null
        checkpoint.textPageNum = 0

        const lcAfterQuery = await getLeadCount(supabase, campaignId)
        if (lcAfterQuery >= leadCap) break textOuter
        if (scrapedThisBatch >= insertBudget) break textOuter
      }

      checkpoint.textQueryIdx = 0

      const lcAfterRi = await getLeadCount(supabase, campaignId)
      if (lcAfterRi >= leadCap) break
      if (scrapedThisBatch >= insertBudget) break
    }

    checkpoint.collectPhase = "collection_done"
    checkpoint.stopCollecting = false
  }

  let emailLeadsNow = await countEmailLeadsForContext(supabase, genCtx)
  let totalLeadsNow = await getLeadCount(supabase, campaignId)

  if (checkpoint.collectPhase === "collection_done" && checkpoint.postPhase === "none") {
    checkpoint.postPhase = "hunter_trim"
  }

  /** ---------- Hunter + trim + finalize ---------- */
  if (checkpoint.postPhase === "hunter_trim") {
    emailLeadsNow = await runHunterFallbackChunk(
      supabase,
      genCtx,
      leadCap,
      BATCH_SIZE,
      checkpoint
    )

    await trimLeadRowsToCap(supabase, campaignId, leadCap)
    totalLeadsNow = await getLeadCount(supabase, campaignId)
    emailLeadsNow = await countEmailLeadsForContext(supabase, genCtx)

    const scrapeComplete = totalLeadsNow >= leadCap
    const finalizePayload: Record<string, unknown> = {
      lead_generation_status: scrapeComplete ? "complete" : "partial",
      lead_generation_stage: "complete",
      scrape_checkpoint: null,
      status: "completed",
      leads_found: totalLeadsNow,
      emails_found: emailLeadsNow,
    }
    const { error: finalizeErr } = await supabase
      .from("campaigns")
      .update(finalizePayload)
      .eq("id", campaignId)
      .eq("user_id", userId)
    if (finalizeErr && String(finalizeErr.message ?? "").includes("emails_found")) {
      delete finalizePayload.emails_found
      const { error: fallbackFinalizeErr } = await supabase
        .from("campaigns")
        .update(finalizePayload)
        .eq("id", campaignId)
        .eq("user_id", userId)
      if (fallbackFinalizeErr) {
        console.log("[scrape] finalize update fallback failed:", fallbackFinalizeErr.message)
      }
    } else if (finalizeErr) {
      console.log("[scrape] finalize update failed:", finalizeErr.message)
    }

    checkpoint.postPhase = "done"

    console.log(
      `[scrape-batch] complete | leads_saved=${totalLeadsNow} emails_found=${emailLeadsNow}`
    )
    const { data: debugQueue } = await supabase
      .from("campaign_messages")
      .select("*")
      .eq("campaign_id", campaignId)
    console.log("FINAL QUEUE STATE:", debugQueue)
    console.log("QUEUE AFTER SCRAPE:", debugQueue)

    return {
      ok: true,
      scrapedThisBatch,
      totalLeadsNow,
      emailLeadsNow,
      done: true,
      leadCap,
      phase: "complete",
    }
  }

  /** Save checkpoint for next poll */
  totalLeadsNow = await getLeadCount(supabase, campaignId)
  emailLeadsNow = await countEmailLeadsForContext(supabase, genCtx)

  await supabase
    .from("campaigns")
    .update({ scrape_checkpoint: checkpoint })
    .eq("id", campaignId)
    .eq("user_id", userId)

  const done = checkpoint.postPhase === "done"

  return {
    ok: true,
    scrapedThisBatch,
    totalLeadsNow,
    emailLeadsNow,
    done,
    leadCap,
    phase: checkpoint.postPhase !== "none" ? checkpoint.postPhase : checkpoint.collectPhase,
  }
  } finally {
    enrichProducersDone = true
    const apiCalls = apiCallsRef.current
    console.log("[TOTAL API CALLS]:", apiCalls)
  }
}
