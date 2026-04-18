/**
 * Campaign lead scraping split into serverless-safe batches with DB checkpointing.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  contactKeyForCampaignLead,
  insertOneCampaignLeadIfUnderCap,
  type LeadRowInput,
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
import { CAMPAIGN_NEARBY_OFFSET_DEG } from "@/lib/campaign-geo-expansion"
import {
  geocodeAddressToTarget,
  isNearbyPlaceInTargetRegion,
  reverseGeocodeToTarget,
  type GeocodedTarget,
} from "@/lib/location-targeting"
import { parseSearchQuery } from "@/lib/parse-search-query"
import { SCRAPE_POLICY } from "@/lib/rate-limit-policy"

const MAX_LEADS = SCRAPE_POLICY.maxLeadsPerScrape
const RADIUS_STEPS = [5000, 10000, 20000, 50000]
const MAX_PLACE_PAGES_PER_SEARCH = 60
const PAGE_TOKEN_DELAY_MS = 1000
const BATCH_SIZE = 15
const SCRAPER_CHUNK_DELAY_MS = 150
const SMART_STOP_MAX_BUSINESSES_SCANNED = 4000
const MAX_RAW_BUSINESSES = 2500
const MAX_CONSECUTIVE_EMPTY_WAVES = 3
const MAX_SEARCH_AREA_STRINGS = 52
const GEOCODE_BATCH_SIZE = 10
const MAX_KEYWORD_VARIANTS = 24
const FETCH_TIMEOUT_MS = 20000
const ENRICH_LEAD_TIMEOUT_MS = 8000
const TEXT_SEARCH_MAX_PAGES_PER_QUERY = 60
const TEXT_SEARCH_BIAS_RADII_M = [35_000, 55_000, 85_000]

/** Inserts per /api/scrape-batch invocation (10–20 range). */
export const SCRAPE_BATCH_INSERT_BUDGET = 15

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
  postPhase: "none" | "contact_fetch" | "hunter_trim" | "done"
  contactFetchOffset: number
}

type SearchPoint = { area: string; lat: number; lng: number }
type PlaceResult = {
  place_id?: string
  name?: string
  vicinity?: string
  formatted_address?: string
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

function rowNeedsContactFetch(row: { email?: unknown; place_id?: unknown }): boolean {
  const pid = row.place_id
  if (typeof pid !== "string" || !pid.trim()) return false
  const em = row.email
  return !(typeof em === "string" && em.trim().length > 0)
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
  maxUpdatesThisCall: number
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
    const enrichedResults = await Promise.all(
      batch.map(async (lead) => {
        try {
          const domain = domainFromWebsiteUrl((lead.website as string) ?? null)
          if (!domain) return { lead, enriched: null as string | null }
          const enriched = await enrichEmail(domain)
          return { lead, enriched }
        } catch {
          return { lead, enriched: null as string | null }
        }
      })
    )

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
}): Promise<CampaignScrapeCheckpoint> {
  const { supabase, ctx, apiKey, storedCampaignCoords } = params
  const niche = ctx.niche
  const location = ctx.location

  let primaryTarget: GeocodedTarget | null = null

  if (storedCampaignCoords) {
    primaryTarget = await reverseGeocodeToTarget(
      storedCampaignCoords.lat,
      storedCampaignCoords.lng,
      location,
      apiKey,
      safeFetch,
      safeJson
    )
    if (primaryTarget) {
      console.log("Using location-based search")
    }
  }

  if (!primaryTarget) {
    primaryTarget = await geocodeAddressToTarget(location, apiKey, safeFetch, safeJson)
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
  }
}

async function fetchWebsiteAndEmailForPlace(
  placeId: string,
  apiKey: string
): Promise<{
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
  const { supabase, campaignId, userId, apiKey } = params
  const insertBudget = params.insertBudget ?? SCRAPE_BATCH_INSERT_BUDGET

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "id, user_id, target_search_query, lead_generation_status, scrape_checkpoint, location_lat, location_lng"
    )
    .eq("id", campaignId)
    .single()

  if (cErr || !campaign) {
    return { ok: false, error: "Campaign not found", scrapedThisBatch: 0, totalLeadsNow: 0, emailLeadsNow: 0, done: true, leadCap: MAX_LEADS, phase: "error" }
  }

  if ((campaign.user_id as string) !== userId) {
    return { ok: false, error: "Unauthorized", scrapedThisBatch: 0, totalLeadsNow: 0, emailLeadsNow: 0, done: true, leadCap: MAX_LEADS, phase: "error" }
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

  const checkpointRaw = campaign.scrape_checkpoint as CampaignScrapeCheckpoint | null
  if (!checkpointRaw || checkpointRaw.v !== 1) {
    return {
      ok: false,
      error: "Scrape not initialized; call generate-leads first",
      scrapedThisBatch: 0,
      totalLeadsNow: await getLeadCount(supabase, campaignId),
      emailLeadsNow: 0,
      done: false,
      leadCap: MAX_LEADS,
      phase: "needs_init",
    }
  }
  let checkpoint: CampaignScrapeCheckpoint = checkpointRaw

  const leadCap = Math.min(MAX_LEADS, SCRAPE_POLICY.maxLeadsPerScrape)
  const ctx: CampaignCtx = {
    campaignId,
    userId,
    niche,
    location,
    leadCap,
  }

  const genCtx: GenCtx = { mode: "campaign", campaignId }

  async function assertCampaignExists(): Promise<boolean> {
    const { data } = await supabase.from("campaigns").select("id").eq("id", campaignId).single()
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
    const enriched = await Promise.all(
      chunk.map(async (p) => {
        try {
          const { website, email, guessedEmail, phone } = await fetchWebsiteAndEmailForPlace(
            p.place_id!,
            apiKey
          )
          return { place: p, website, email, guessedEmail, phone }
        } catch {
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

    let leadsCollected = await getLeadCount(supabase, campaignId)

    for (let i = 0; i < enriched.length; i++) {
      if (scrapedThisBatch >= insertBudget) break
      if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) break

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
        console.log(`Scraped ${scrapedThisBatch} leads`)
        console.log(`Total leads now: ${leadsCollected}`)
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
    while (batch.length > 0 && scrapedThisBatch < insertBudget) {
      if (!(await assertCampaignExists())) {
        checkpoint.stopCollecting = true
        return
      }

      let leadsCollected = await getLeadCount(supabase, campaignId)
      if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) return

      const slice = batch.splice(0, BATCH_SIZE)
      const enriched = await Promise.all(
        slice.map(async (p) => {
          try {
            const { website, email, guessedEmail, phone } =
              await fetchWebsiteAndEmailForPlace(p.place_id!, apiKey)
            return { place: p, website, email, guessedEmail, phone }
          } catch {
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
        if (scrapedThisBatch >= insertBudget) return
        leadsCollected = await getLeadCount(supabase, campaignId)
        if (tryStopCampaignScrape(leadsCollected, checkpoint.rawBusinessesSeen, checkpoint.stopCollecting)) return

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
          console.log(`Scraped ${scrapedThisBatch} leads`)
          console.log(`Total leads now: ${leadsCollected}`)
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
      if (
        !checkpoint.stopCollecting &&
        checkpoint.campaignGeoOffsetIdx < CAMPAIGN_NEARBY_OFFSET_DEG.length &&
        checkpoint.wave > 1
      ) {
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

      await supabase
        .from("campaigns")
        .update({
          lead_generation_stage:
            checkpoint.wave === 1 ? "searching" : appendedGeoCenter ? "expanding" : "searching",
        })
        .eq("id", campaignId)

      outer: while (
        checkpoint.pi < checkpoint.searchPoints.length &&
        scrapedThisBatch < insertBudget &&
        !checkpoint.stopCollecting
      ) {
        const point = checkpoint.searchPoints[checkpoint.pi]

        innerR: while (
          checkpoint.r < RADIUS_STEPS.length &&
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

              const url = !requestToken
                ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${point.lat},${point.lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${apiKey}`
                : `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${requestToken}&key=${apiKey}`

              const res = await safeFetch(url)
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
                if (!placeId || globalDedupe.seenPlaceIds.has(placeId)) continue
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
        while (checkpoint.campaignPlaceBuffer.length > 0 && scrapedThisBatch < insertBudget) {
          await flushBufferChunk(checkpoint.campaignPlaceBuffer, globalDedupe)
        }
      }

      leadsCollected = await getLeadCount(supabase, campaignId)
      const waveInserted = scrapedThisBatch - waveScrapedStart

      if (leadsCollected >= leadCap) {
        checkpoint.collectPhase = "collection_done"
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

  if (
    checkpoint.postPhase === "none" &&
    checkpoint.collectPhase === "text_search" &&
    scrapedThisBatch < insertBudget
  ) {
    await supabase
      .from("campaigns")
      .update({ lead_generation_stage: "searching" })
      .eq("id", campaignId)

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
          if (!(await assertCampaignExists())) {
            checkpoint.stopCollecting = true
            break textOuter
          }

          let leadsCollected = await getLeadCount(supabase, campaignId)
          if (leadsCollected >= leadCap || checkpoint.rawBusinessesSeen >= MAX_RAW_BUSINESSES) {
            checkpoint.collectPhase = "collection_done"
            break textOuter
          }

          let url: string
          if (!checkpoint.textPageToken) {
            url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
              query
            )}&location=${primaryTarget.lat},${primaryTarget.lng}&radius=${radiusBias}&key=${apiKey}`
          } else {
            await scraperDelay(PAGE_TOKEN_DELAY_MS)
            url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(
              checkpoint.textPageToken
            )}&key=${apiKey}`
          }

          const res = await safeFetch(url)
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

  /** ---------- Contact fetch (batched) ---------- */
  let emailLeadsNow = await countEmailLeadsForContext(supabase, genCtx)
  let totalLeadsNow = await getLeadCount(supabase, campaignId)

  if (
    checkpoint.collectPhase === "collection_done" &&
    checkpoint.postPhase === "none" &&
    totalLeadsNow > 0
  ) {
    checkpoint.postPhase = "contact_fetch"
    checkpoint.contactFetchOffset = 0
  }

  if (
    checkpoint.collectPhase === "collection_done" &&
    checkpoint.postPhase === "none" &&
    totalLeadsNow === 0
  ) {
    checkpoint.postPhase = "hunter_trim"
  }

  if (checkpoint.postPhase === "contact_fetch") {
    await supabase
      .from("campaigns")
      .update({ lead_generation_stage: "enriching" })
      .eq("id", campaignId)

    const { data: rows } = await supabase
      .from("leads")
      .select("id, place_id, email")
      .eq("campaign_id", campaignId)

    const needsEnrich = (rows || []).filter((r) => rowNeedsContactFetch(r))
    const chunk = needsEnrich.slice(checkpoint.contactFetchOffset, checkpoint.contactFetchOffset + BATCH_SIZE)

    for (const row of chunk) {
      const signal = AbortSignal.timeout(ENRICH_LEAD_TIMEOUT_MS)
      try {
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
          row.place_id as string
        )}&fields=website,formatted_phone_number&key=${apiKey}`
        const res = await fetch(detailsUrl, { signal })
        if (!res.ok) continue
        const details = (await res.json()) as {
          result?: { website?: string; formatted_phone_number?: string }
        }

        const website = details.result?.website ?? null
        const phoneFromDetails = details.result?.formatted_phone_number?.trim() || null

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

        await supabase.from("leads").update(updatePayload).eq("id", row.id as string)
      } catch {
        /* skip */
      }
    }

    checkpoint.contactFetchOffset += chunk.length
    if (checkpoint.contactFetchOffset >= needsEnrich.length) {
      checkpoint.postPhase = "hunter_trim"
    }
  }

  /** ---------- Hunter + trim + finalize ---------- */
  if (checkpoint.postPhase === "hunter_trim") {
    emailLeadsNow = await runHunterFallbackChunk(supabase, genCtx, leadCap, BATCH_SIZE)

    await trimLeadRowsToCap(supabase, campaignId, leadCap)
    totalLeadsNow = await getLeadCount(supabase, campaignId)
    emailLeadsNow = await countEmailLeadsForContext(supabase, genCtx)

    const scrapeComplete = totalLeadsNow >= leadCap
    await supabase
      .from("campaigns")
      .update({
        lead_generation_status: scrapeComplete ? "complete" : "partial",
        lead_generation_stage: "complete",
        scrape_checkpoint: null,
      })
      .eq("id", campaignId)

    checkpoint.postPhase = "done"

    console.log(
      `[scrape-batch] complete | leads_saved=${totalLeadsNow} emails_found=${emailLeadsNow}`
    )

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

  await supabase.from("campaigns").update({ scrape_checkpoint: checkpoint }).eq("id", campaignId)

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
}
