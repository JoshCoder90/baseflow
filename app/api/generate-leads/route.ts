import { NextResponse } from "next/server"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import OpenAI from "openai"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

if (!supabaseServiceKey) {
  throw new Error("SUPABASE_SERVICE_KEY missing from env")
}

const MAX_LEADS = 200
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
const RADIUS_STEPS = [5000, 7500, 10000, 15000, 20000]
const PAGE_TOKEN_DELAY_MS = 1000
const INSERT_BATCH_SIZE = 15
const ENRICH_BATCH_SIZE = 8
const FETCH_TIMEOUT_MS = 20000

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

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "icloud.com", "me.com", "mac.com", "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "msn.com", "aol.com", "protonmail.com",
  "mail.com", "zoho.com", "yandex.com", "gmx.com", "gmx.net",
])

function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase()
  if (!domain) return true
  return [...PERSONAL_EMAIL_DOMAINS].some(
    (d) => domain === d || domain.endsWith("." + d)
  )
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `https://${trimmed}`
  }
  return trimmed
}

async function scrapeEmailFromWebsite(website: string): Promise<string | null> {
  const base = normalizeUrl(website)
  let contactUrl: string
  let contactUsUrl: string
  try {
    contactUrl = new URL("/contact", base).toString()
    contactUsUrl = new URL("/contact-us", base).toString()
  } catch {
    contactUrl = base
    contactUsUrl = base
  }
  const urlsToTry = [...new Set([base, contactUrl, contactUsUrl])]

  const seen = new Set<string>()

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BaseFlow/1.0; +https://baseflow.app)" },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      const html = await res.text()
      const matches = html.match(EMAIL_REGEX) || []

      for (const raw of matches) {
        const email = raw.toLowerCase().trim()
        if (seen.has(email)) continue
        seen.add(email)

        if (isPersonalEmail(email)) continue
        if (email.includes("example.") || email.includes("your-domain")) continue
        if (email.endsWith(".png") || email.endsWith(".jpg") || email.endsWith(".gif")) continue

        return email
      }
    } catch {
      // Skip failed URL, try next
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
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

type GenerationContext =
  | { mode: "audience"; audienceId: string; userId: string; niche: string; location: string; leadCap: number }
  | { mode: "campaign"; campaignId: string; userId: string; searchQuery: string; niche: string; location: string; leadCap: number }

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

export async function POST(req: Request) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  let ctx: GenerationContext

  try {
    const body = await req.json()

    // New flow: campaign-based with natural language search
    if (body.campaign_id && body.search_query) {
      const campaignId = body.campaign_id as string
      const searchQuery = (body.search_query as string)?.trim()
      if (!searchQuery) {
        return NextResponse.json({ error: "search_query is required" }, { status: 400 })
      }
      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("id, user_id")
        .eq("id", campaignId)
        .single()
      if (campErr || !campaign) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
      }
      const { niche, location } = await parseSearchQuery(searchQuery)
      await supabase
        .from("campaigns")
        .update({ target_search_query: searchQuery })
        .eq("id", campaignId)
      ctx = {
        mode: "campaign",
        campaignId,
        userId: campaign.user_id,
        searchQuery,
        niche,
        location,
        leadCap: Math.min(DEFAULT_LEAD_CAP, body.lead_cap ?? DEFAULT_LEAD_CAP),
      }
    }
    // Legacy flow: audience-based
    else if (body.audience?.id) {
      const audience = body.audience
      ctx = {
        mode: "audience",
        audienceId: audience.id,
        userId: audience.user_id,
        niche: audience.niche || "",
        location: audience.location || "",
        leadCap: audience.target_leads ?? DEFAULT_LEAD_CAP,
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

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "Google Places API key missing" }, { status: 500 })
  }

  const niche = ctx.niche
  const location = ctx.location
  const leadCap = Math.min(MAX_LEADS, ctx.leadCap)

  try {
  // Fetch existing leads for deduplication
  const leadsQuery = supabase.from("leads").select("place_id")
  if (ctx.mode === "audience") {
    leadsQuery.eq("audience_id", ctx.audienceId)
  } else {
    leadsQuery.eq("campaign_id", ctx.campaignId)
  }
  const { data: existingLeads } = await leadsQuery

  const existingPlaceIds = new Set((existingLeads || []).map((l) => l.place_id).filter(Boolean))
  const seenPlaceIds = new Set<string>(existingPlaceIds)

  let leadsCollected = await getLeadCount(supabase, ctx)
  const targetNewLeads = Math.max(0, leadCap - leadsCollected)

  if (ctx.mode === "audience" && targetNewLeads === 0) {
    console.log(`Audience already at cap (${leadCap} leads). Skipping generation.`)
    await updateProgress(supabase, ctx.audienceId, leadsCollected, "ready")
    return NextResponse.json({ success: true, count: leadsCollected })
  }
  if (ctx.mode === "campaign" && targetNewLeads === 0) {
    await supabase
      .from("campaigns")
      .update({ lead_generation_status: "complete", lead_generation_stage: "complete" })
      .eq("id", ctx.campaignId)
    return NextResponse.json({ success: true, count: leadsCollected, total: leadsCollected })
  }

  if (ctx.mode === "audience") {
    await updateProgress(supabase, ctx.audienceId, leadsCollected, "generating")
  }
  if (ctx.mode === "campaign") {
    await supabase
      .from("campaigns")
      .update({ lead_generation_status: "generating", lead_generation_stage: "searching" })
      .eq("id", ctx.campaignId)
  }

  const searchAreas = [
    location,
    `near ${location}`,
    `${location} downtown`,
    `${location} center`,
    `north ${location}`,
    `south ${location}`,
    `east ${location}`,
    `west ${location}`,
  ]

  const savedLeadRows: { id: string; place_id: string }[] = []

  // Build list of (area, lat, lng) to search (parallel geocode)
  type SearchPoint = { area: string; lat: number; lng: number }
  const geoResults = await Promise.all(
    searchAreas.map(async (area) => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(area)}&key=${apiKey}`
      const res = await safeFetch(url)
      const geoData = await safeJson<{ results?: { geometry: { location: { lat: number; lng: number } } }[] }>(res)
      if (geoData?.results?.length) {
        const lat = geoData.results[0].geometry.location.lat
        const lng = geoData.results[0].geometry.location.lng
        return { area, lat, lng }
      }
      return null
    })
  )
  const searchPoints = geoResults.filter((p): p is SearchPoint => p !== null)

  let businessesCollected = 0
  let uniqueBusinesses = 0

  // Main loop: search all areas and radii until MAX_LEADS or market exhausted
  outer: for (const point of searchPoints) {
    leadsCollected = await getLeadCount(supabase, ctx)
    if (leadsCollected >= MAX_LEADS) {
      console.log("Lead cap reached (200)")
      break
    }

    for (let r = 0; r < RADIUS_STEPS.length; r++) {
      const radius = RADIUS_STEPS[r]
      leadsCollected = await getLeadCount(supabase, ctx)
      if (leadsCollected >= MAX_LEADS) {
        console.log("Lead cap reached (200)")
        break outer
      }

      console.log(`Searching area: ${point.area}, radius ${radius}m`)
      let nextPageToken: string | null = null
      let pageNum = 0
      let lastPageSize = 0

      // Paginate through this (area, radius) until no more pages (max 3 per search)
      while (true) {
        leadsCollected = await getLeadCount(supabase, ctx)
        if (leadsCollected >= MAX_LEADS) {
          console.log("Lead cap reached (200)")
          break outer
        }
        let url: string
        if (!nextPageToken) {
          url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${point.lat},${point.lng}&radius=${radius}&keyword=${encodeURIComponent(niche)}&key=${apiKey}`
        } else {
          await new Promise((r) => setTimeout(r, PAGE_TOKEN_DELAY_MS))
          console.log("Fetching next page...")
          url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${apiKey}`
        }

        const res = await safeFetch(url)
        type PlaceResult = { place_id?: string; name?: string; vicinity?: string; formatted_address?: string; rating?: number }
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

        if (results.length === 0 && !nextPageToken) {
          break
        }

        // Collect new places (not seen, not at cap)
        const candidatePlaces = []
        for (const place of results) {
          leadsCollected = await getLeadCount(supabase, ctx)
          if (leadsCollected >= MAX_LEADS) break outer
          const placeId = place.place_id
          if (!placeId || seenPlaceIds.has(placeId)) continue
          seenPlaceIds.add(placeId)
          uniqueBusinesses++
          candidatePlaces.push(place)
        }

        // Bulk check existing place_ids
        if (candidatePlaces.length === 0) {
          // nothing to insert, skip to next page
        } else {
          const idField = ctx.mode === "campaign" ? "campaign_id" : "audience_id"
          const idValue = ctx.mode === "campaign" ? ctx.campaignId : ctx.audienceId
          const placeIds = candidatePlaces.map((p) => p.place_id)
          const { data: existingByPlace } = await supabase
            .from("leads")
            .select("place_id")
            .eq(idField, idValue)
            .in("place_id", placeIds)
          const existingSet = new Set((existingByPlace || []).map((l) => l.place_id))

          const toInsert = candidatePlaces.filter((p) => !existingSet.has(p.place_id))
          const leadRows = toInsert.map((place) => {
            const row: Record<string, unknown> = {
              user_id: ctx.userId,
              name: place.name,
              company: place.name,
              address: place.vicinity || place.formatted_address || null,
              google_rating: place.rating || null,
              status: "cold",
              place_id: place.place_id,
              phone: null,
              website: null,
            }
            if (ctx.mode === "audience") row.audience_id = ctx.audienceId
            else row.campaign_id = ctx.campaignId
            return row
          })

          // Batch insert (never crash - skip failed batches, hard cap at MAX_LEADS)
          for (let i = 0; i < leadRows.length; i += INSERT_BATCH_SIZE) {
            leadsCollected = await getLeadCount(supabase, ctx)
            if (leadsCollected >= MAX_LEADS) {
              console.log("Lead cap reached, stopping scrape")
              break outer
            }
            let batch = leadRows.slice(i, i + INSERT_BATCH_SIZE)
            if (leadsCollected + batch.length > MAX_LEADS) {
              const remaining = MAX_LEADS - leadsCollected
              batch = batch.slice(0, remaining)
            }
            try {
              const { data: inserted, error: insertError } = await supabase
                .from("leads")
                .insert(batch)
                .select("id, place_id")
              if (insertError) {
                console.log("Insert error, continuing:", insertError.message)
              } else if (inserted) {
                savedLeadRows.push(...inserted)
              }
            } catch (err) {
              console.log("Batch insert error, continuing:", err)
            }
          }
          leadsCollected = await getLeadCount(supabase, ctx)
          console.log(`Businesses collected: ${businessesCollected} | Unique after dedupe: ${uniqueBusinesses} | Leads in DB: ${leadsCollected}`)
        }

        if (ctx.mode === "audience") {
          leadsCollected = await getLeadCount(supabase, ctx)
          await updateProgress(supabase, ctx.audienceId, leadsCollected, "generating")
        }

        nextPageToken = data.next_page_token ?? null
        pageNum++

        if (!nextPageToken) break
        // Google limits to 3 pages (60 results) per search
        if (pageNum >= 2) break
      }

      if (lastPageSize < 20 && r < RADIUS_STEPS.length - 1) {
        console.log("Expanding search radius...")
      }
    }
  }

  leadsCollected = await getLeadCount(supabase, ctx)
  if (leadsCollected < leadCap) {
    console.log(
      `Source exhausted: only ${leadsCollected} valid leads found (target was ${leadCap}).`
    )
  }

  console.log(`Lead generation complete. Saved ${savedLeadRows.length} new leads (total in DB: ${leadsCollected})`)

  if (ctx.mode === "audience") {
    await updateProgress(supabase, ctx.audienceId, leadsCollected, "enriching")
  }
  if (ctx.mode === "campaign") {
    await supabase
      .from("campaigns")
      .update({ lead_generation_stage: "enriching" })
      .eq("id", ctx.campaignId)
  }

  // Enrich with Place Details API (parallel batches)
  console.log("Enriching leads with Place Details API...")
  async function enrichLead(lead: { id: string; place_id: string }) {
    try {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${lead.place_id}&fields=formatted_phone_number,website&key=${apiKey}`
      const res = await safeFetch(detailsUrl)
      const details = await safeJson<{ result?: { formatted_phone_number?: string; website?: string } }>(res)
      if (!details) return false

      const phone = details.result?.formatted_phone_number ?? null
      const website = details.result?.website ?? null

      let email: string | null = null
      if (website?.trim()) {
        email = await scrapeEmailFromWebsite(website)
      }

      const { error } = await supabase
        .from("leads")
        .update({
          phone: phone || null,
          website: website || null,
          email: email || null,
        })
        .eq("id", lead.id)
      if (error) {
        console.log("Enrichment update failed, skipping", lead.place_id, error.message)
        return false
      }
      return true
    } catch (err) {
      console.log("Enrichment failed, skipping", lead.place_id, err)
      return false
    }
  }

  for (let i = 0; i < savedLeadRows.length; i += ENRICH_BATCH_SIZE) {
    const batch = savedLeadRows.slice(i, i + ENRICH_BATCH_SIZE)
    await Promise.all(batch.map(enrichLead))
  }
  console.log("Place Details enrichment complete.")

  leadsCollected = await getLeadCount(supabase, ctx)
  if (ctx.mode === "audience") {
    const finalStatus = leadsCollected >= leadCap ? "ready" : "market_exhausted"
    await updateProgress(supabase, ctx.audienceId, leadsCollected, finalStatus)
  }

  if (ctx.mode === "campaign") {
    await supabase
      .from("campaigns")
      .update({ lead_generation_status: "complete", lead_generation_stage: "complete" })
      .eq("id", ctx.campaignId)
  }

  return NextResponse.json({
    success: true,
    count: savedLeadRows.length,
    total: leadsCollected,
  })
  } catch (err) {
    console.error("Lead generation failed:", err)
    if (ctx.mode === "audience") {
      await supabase
        .from("audiences")
        .update({ status: "failed" })
        .eq("id", ctx.audienceId)
    }
    if (typeof ctx !== "undefined" && ctx.mode === "campaign") {
      await supabase
        .from("campaigns")
        .update({ lead_generation_status: "failed" })
        .eq("id", ctx.campaignId)
    }
    return NextResponse.json(
      { error: "Lead generation failed" },
      { status: 500 }
    )
  }
}
