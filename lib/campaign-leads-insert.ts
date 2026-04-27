import type { SupabaseClient } from "@supabase/supabase-js"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"

export const MAX_LEADS_PER_CAMPAIGN = 200

/** Max rows in DB during bulk scrape (before pruning to target valid count). */
export const SCRAPER_MAX_ROWS_PER_CAMPAIGN = 800

export type LeadRowInput = Record<string, unknown> & {
  email?: string | null
  /** Non-null when email was inferred as info@ / contact@ / hello@ (not scraped from HTML). */
  guessed_email?: string | null
  phone?: string | null
  website?: string | null
  name?: string | null
  place_id?: string | null
}

export type InsertCampaignLeadsReason =
  | "max_reached"
  | "duplicate_email"
  | "invalid_contact"
  | "none"

export type InsertCampaignLeadsOptions = {
  /** Columns to return from insert; default id + place_id */
  select?: string
  /** During generate-leads: allow more rows until valid target is met (capped at SCRAPER_MAX_ROWS_PER_CAMPAIGN). */
  maxRowsForCampaign?: number
}

export type InsertCampaignLeadsResult = {
  inserted: number
  skipped: boolean
  error: Error | null
  reason: InsertCampaignLeadsReason
  rows: Record<string, unknown>[] | null
}

/** Host only, no www — dedupes same business across URLs. */
export function normalizeWebsiteDomain(website: string | null | undefined): string | null {
  const w = (website ?? "").trim()
  if (!w) return null
  try {
    const u = new URL(w.includes("://") ? w : `https://${w}`)
    const host = u.hostname.replace(/^www\./i, "").toLowerCase()
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

/**
 * Dedupe key: normalized email, else website domain, else place_id + id (email-only outreach).
 */
export function contactKeyForCampaignLead(lead: {
  email?: string | null
  phone?: string | null
  website?: string | null
  name?: string | null
  place_id?: string | null
  id?: string
}): string {
  const e = typeof lead.email === "string" ? lead.email.trim().toLowerCase() : ""
  if (e.length > 0) return `e:${e}`
  const domain = normalizeWebsiteDomain(
    typeof lead.website === "string" ? lead.website : null
  )
  if (domain) return `d:${domain}`
  const pid = typeof lead.place_id === "string" ? lead.place_id.trim() : ""
  const id = typeof lead.id === "string" ? lead.id : ""
  return `|${pid}|${id}`
}

/** At least one contact point: email or website (lead gen still allows place_id-only rows). */
function hasContactPoint(lead: LeadRowInput): boolean {
  const hasEmail = typeof lead.email === "string" && lead.email.trim().length > 0
  const hasWebsite = typeof lead.website === "string" && lead.website.trim().length > 0
  return hasEmail || hasWebsite
}

/** Lead gen inserts rows before enrichment; allow place_id-only until contact fields exist. */
function isValidLeadForInsert(lead: LeadRowInput): boolean {
  const hasPlaceId =
    typeof lead.place_id === "string" && lead.place_id.trim().length > 0
  return hasContactPoint(lead) || hasPlaceId
}

/**
 * Inserts leads for a campaign: dedupes by contact key, enforces max rows per campaign (200 default).
 * Preserves all fields on each row (place_id, user_id, address, etc.) for generate-leads.
 */
export async function insertCampaignLeads(
  supabase: SupabaseClient,
  campaignId: string,
  newLeads: LeadRowInput[],
  options?: InsertCampaignLeadsOptions
): Promise<InsertCampaignLeadsResult> {
  const selectClause = options?.select ?? "id, place_id"
  const requested =
    options?.maxRowsForCampaign ?? MAX_LEADS_PER_CAMPAIGN
  const MAX_LEADS = Math.min(requested, SCRAPER_MAX_ROWS_PER_CAMPAIGN)

  const { data: existingLeads, error: existingError } = await supabase
    .from("leads")
    .select("id, email, website, name, place_id")
    .eq("campaign_id", campaignId)

  if (existingError) {
    console.error("FAILED TO LOAD EXISTING LEADS", existingError)
    return {
      inserted: 0,
      skipped: false,
      error: new Error(existingError.message),
      reason: "none",
      rows: null,
    }
  }

  const existingCount = existingLeads?.length ?? 0
  const remainingSlots = Math.max(0, MAX_LEADS - existingCount)

  if (remainingSlots === 0) {
    console.log("Max leads reached, skipping insert")
    return {
      inserted: 0,
      skipped: true,
      error: null,
      reason: "max_reached",
      rows: null,
    }
  }

  const validLeads = newLeads.filter((lead) => isValidLeadForInsert(lead as LeadRowInput))

  const seen = new Set(
    (existingLeads || []).map((lead) => contactKeyForCampaignLead(lead))
  )

  const dedupedNewLeads = validLeads.filter((lead) => {
    const key = contactKeyForCampaignLead(lead as LeadRowInput)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const leadsToInsert = dedupedNewLeads.slice(0, remainingSlots).map((lead) => ({
    ...lead,
    campaign_id: campaignId,
    status: (lead.status as string) ?? "new",
  }))

  if (leadsToInsert.length === 0) {
    let reason: InsertCampaignLeadsReason = "none"
    if (newLeads.length > 0) {
      if (validLeads.length === 0) reason = "invalid_contact"
      else reason = "duplicate_email"
    }
    return { inserted: 0, skipped: false, error: null, reason, rows: null }
  }

  const { data: insertedRows, error: insertError } = await supabase
    .from("leads")
    .insert(leadsToInsert)
    .select(selectClause)

  if (insertError) {
    console.error("FAILED TO INSERT LEADS", insertError)
    return {
      inserted: 0,
      skipped: false,
      error: new Error(insertError.message),
      reason: "none",
      rows: null,
    }
  }

  return {
    inserted: leadsToInsert.length,
    skipped: false,
    error: null,
    reason: "none",
    rows: (insertedRows as unknown as Record<string, unknown>[] | null) ?? null,
  }
}

/**
 * Insert one campaign lead: email and/or website (website-only allowed). Max total rows = maxTotalRows.
 * Dedupes via `seenContactKeys` (must include existing DB keys + normalized `e:email` for duplicates).
 */
export async function insertOneCampaignLeadIfUnderCap(
  supabase: SupabaseClient,
  campaignId: string,
  row: LeadRowInput,
  maxTotalRows: number,
  currentRowCount: number,
  seenContactKeys: Set<string>
): Promise<{ id: string; place_id: string } | null> {
  const placeRaw = typeof row.place_id === "string" ? row.place_id.trim() : ""
  if (!placeRaw) return null

  const emRaw = typeof row.email === "string" ? row.email.trim() : ""
  const webRaw = typeof row.website === "string" ? row.website.trim() : ""
  if (emRaw && !isEmailAllowedForCampaignQueue(emRaw)) return null
  if (!isValidLeadForInsert(row)) return null

  if (emRaw) {
    const emailKey = `e:${emRaw.toLowerCase()}`
    if (seenContactKeys.has(emailKey)) return null
  }

  const key = contactKeyForCampaignLead(row as LeadRowInput)
  if (seenContactKeys.has(key)) return null

  if (currentRowCount >= maxTotalRows) return null
  if (currentRowCount >= SCRAPER_MAX_ROWS_PER_CAMPAIGN) return null

  const payload = {
    ...row,
    campaign_id: campaignId,
    status: (row.status as string) ?? "pending",
  }

  const { data: leadInsert, error } = await supabase
    .from("leads")
    .insert(payload)
    .select("id, place_id, name, company, user_id")
    .single()

  if (error) {
    console.log("insertOneCampaignLeadIfUnderCap insert error:", error.message)
    return null
  }

  const newLead = leadInsert

  seenContactKeys.add(key)
  if (emRaw) seenContactKeys.add(`e:${emRaw.toLowerCase()}`)

  const id = newLead?.id as string | undefined
  const place_id = newLead?.place_id as string | undefined
  if (typeof id === "string" && typeof place_id === "string") {
    console.log("CREATING QUEUE FOR LEAD:", newLead.id)
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("message_template")
      .eq("id", campaignId)
      .single()
    const { data: _queueRows, error: queueError } = await supabase
      .from("campaign_messages")
      .insert({
        campaign_id: campaignId,
        lead_id: newLead.id,
        step_number: 1,
        status: "queued",
        send_at: new Date().toISOString(),
        user_id: (newLead?.user_id as string) ?? (row.user_id as string),
        message_body: campaign?.message_template || "Hi, quick question...",
      })
      .select("id")

    if (queueError) {
      console.error("QUEUE INSERT FAILED:", queueError)
    } else {
      console.log("[QUEUE CREATED]", {
        lead: newLead.id,
        user: (newLead?.user_id as string) ?? (row.user_id as string),
      })
    }
    return { id, place_id }
  }
  return null
}
