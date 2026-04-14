/**
 * Valid lead for targeting: good email OR website (email-only product; phone column unused).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"

export type LeadContactRow = {
  id?: string
  email?: string | null
  website?: string | null
}

/** True if this lead is worth keeping for outreach after enrichment. */
export function isValidLeadForTargeting(row: LeadContactRow): boolean {
  const email = row.email?.trim()
  if (email && isEmailAllowedForCampaignQueue(email)) return true

  const web = row.website?.trim().toLowerCase() ?? ""
  if (web.length > 4 && (web.startsWith("http") || web.includes("."))) return true

  return false
}

type GenCtx =
  | { mode: "audience"; audienceId: string }
  | { mode: "campaign"; campaignId: string }

export async function countValidLeadsForContext(
  supabase: SupabaseClient,
  ctx: GenCtx
): Promise<number> {
  const q = supabase.from("leads").select("id, email, website")
  if (ctx.mode === "campaign") q.eq("campaign_id", ctx.campaignId)
  else q.eq("audience_id", ctx.audienceId)

  const { data, error } = await q
  if (error) {
    console.error("countValidLeadsForContext:", error)
    return 0
  }
  return (data ?? []).filter((r) => isValidLeadForTargeting(r)).length
}

/** Leads with a queue-allowed email (scrape target: one row per sendable address). */
export async function countEmailLeadsForContext(
  supabase: SupabaseClient,
  ctx: GenCtx
): Promise<number> {
  const q = supabase.from("leads").select("id, email")
  if (ctx.mode === "campaign") q.eq("campaign_id", ctx.campaignId)
  else q.eq("audience_id", ctx.audienceId)

  const { data, error } = await q
  if (error) {
    console.error("countEmailLeadsForContext:", error)
    return 0
  }
  return (data ?? []).filter((r) => {
    const e = r.email?.trim()
    return !!(e && isEmailAllowedForCampaignQueue(e))
  }).length
}

/** Removes leads that fail validity (no usable contact). */
export async function pruneInvalidLeadsForContext(
  supabase: SupabaseClient,
  ctx: GenCtx
): Promise<number> {
  const q = supabase.from("leads").select("id, email, website")
  if (ctx.mode === "campaign") q.eq("campaign_id", ctx.campaignId)
  else q.eq("audience_id", ctx.audienceId)

  const { data, error } = await q
  if (error) {
    console.error("pruneInvalidLeadsForContext select:", error)
    return 0
  }

  const invalidIds = (data ?? [])
    .filter((r) => !isValidLeadForTargeting(r))
    .map((r) => r.id as string)
    .filter(Boolean)

  for (const id of invalidIds) {
    const { error: delErr } = await supabase.from("leads").delete().eq("id", id)
    if (delErr) console.error("prune delete:", id, delErr)
  }
  return invalidIds.length
}

/** After pruning invalid, if more than `cap` valid leads remain, delete the excess (oldest by id). */
export async function trimValidLeadsToCap(
  supabase: SupabaseClient,
  ctx: GenCtx,
  cap: number
): Promise<number> {
  const q = supabase.from("leads").select("id, email, website").order("id", { ascending: true })
  if (ctx.mode === "campaign") q.eq("campaign_id", ctx.campaignId)
  else q.eq("audience_id", ctx.audienceId)

  const { data, error } = await q
  if (error) {
    console.error("trimValidLeadsToCap select:", error)
    return 0
  }

  const rows = data ?? []
  const validRows = rows.filter((r) => isValidLeadForTargeting(r))
  if (validRows.length <= cap) return 0

  const toRemove = validRows.slice(cap)
  let removed = 0
  for (const r of toRemove) {
    const id = r.id as string
    if (!id) continue
    const { error: delErr } = await supabase.from("leads").delete().eq("id", id)
    if (delErr) console.error("trim delete:", id, delErr)
    else removed++
  }
  return removed
}
