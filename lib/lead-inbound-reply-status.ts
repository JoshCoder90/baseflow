import type { SupabaseClient } from "@supabase/supabase-js"

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase()
}

function isRepliedLikeStatus(status: string | null | undefined): boolean {
  const t = norm(status)
  return t === "replied" || t.includes("reply")
}

/** Values on `leads.status` from AddLeadModal / pipeline — keep visible, do not replace with `replied`. */
const PIPELINE_STATUSES_TO_KEEP = new Set(["interested", "meeting booked", "closed"])

/**
 * Align list UI and filters with inbox + campaign tabs: any `messages` row with role `inbound` or `lead`.
 * Does not persist to `leads.status` (that column is still used for sent/messaged counts and queue rules).
 */
export function applyInboundReplyToLeadStatus<T extends { id: string; status: string | null }>(
  lead: T,
  leadIdsWithInbound: Set<string>
): T {
  if (!leadIdsWithInbound.has(lead.id)) return lead
  const n = norm(lead.status)
  if (n === "invalid_email") return lead
  if (PIPELINE_STATUSES_TO_KEEP.has(n)) return lead
  if (isRepliedLikeStatus(lead.status)) return lead
  return { ...lead, status: "replied" }
}

export async function fetchLeadIdsWithInboundMessages(
  supabase: SupabaseClient,
  leadIds: string[],
  chunkSize = 200
): Promise<Set<string>> {
  const out = new Set<string>()
  if (leadIds.length === 0) return out
  for (let i = 0; i < leadIds.length; i += chunkSize) {
    const chunk = leadIds.slice(i, i + chunkSize)
    const { data, error } = await supabase
      .from("messages")
      .select("lead_id")
      .in("lead_id", chunk)
      .in("role", ["inbound", "lead"])
    if (error) {
      console.error("[fetchLeadIdsWithInboundMessages]", error.message)
      continue
    }
    for (const row of data ?? []) {
      const lid = (row as { lead_id?: string | null }).lead_id
      if (lid) out.add(lid)
    }
  }
  return out
}
