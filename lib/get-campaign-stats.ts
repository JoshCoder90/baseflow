import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Outbound row successfully sent (Gmail accepted).
 * Source: `campaign_messages.status` only (not `sent_at` heuristics).
 */
export const CAMPAIGN_MESSAGE_STATUS_SENT = "sent" as const

/**
 * Not yet successfully sent; excludes `failed`.
 * Includes legacy `pending` (pre-schedule / unscheduled) — same UX as queued.
 */
export const CAMPAIGN_MESSAGE_NOT_SENT_STATUSES = ["queued", "sending", "pending"] as const

export const CAMPAIGN_MESSAGE_STATUS_FAILED = "failed" as const

export type CampaignQueueStats = {
  sent: number
  notSent: number
  failed: number
}

/**
 * DB-backed counts for `campaign_messages` for one campaign.
 * Use everywhere UI shows Sent / Not Sent / Failed for the queue.
 */
export async function getCampaignStats(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CampaignQueueStats> {
  const [sentR, notSentR, failedR] = await Promise.all([
    supabase
      .from("campaign_messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", CAMPAIGN_MESSAGE_STATUS_SENT),
    supabase
      .from("campaign_messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", [...CAMPAIGN_MESSAGE_NOT_SENT_STATUSES]),
    supabase
      .from("campaign_messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", CAMPAIGN_MESSAGE_STATUS_FAILED),
  ])

  return {
    sent: sentR.count ?? 0,
    notSent: notSentR.count ?? 0,
    failed: failedR.count ?? 0,
  }
}

const NOT_SENT_STATUS_SET = new Set<string>(CAMPAIGN_MESSAGE_NOT_SENT_STATUSES)

/** Live counts from `campaign_messages` for many campaigns (campaign list, polling). */
export type CampaignListQueueCounts = {
  sent: number
  notSent: number
}

/**
 * One query over `campaign_messages` (campaign_id + status only), aggregated in memory.
 * Aligns with {@link getCampaignStats} / queue tab (sent vs queued+sending+pending, not `campaigns.sent_count`).
 */
export async function getQueueStatsMapForCampaignIds(
  supabase: SupabaseClient,
  campaignIds: string[]
): Promise<Map<string, CampaignListQueueCounts>> {
  const map = new Map<string, CampaignListQueueCounts>()
  for (const id of campaignIds) {
    map.set(id, { sent: 0, notSent: 0 })
  }
  if (campaignIds.length === 0) return map

  const { data, error } = await supabase
    .from("campaign_messages")
    .select("campaign_id, status")
    .in("campaign_id", campaignIds)

  if (error) {
    console.error("[getQueueStatsMapForCampaignIds]", error)
    return map
  }

  for (const row of data ?? []) {
    const cid = row.campaign_id as string
    const st = String(row.status ?? "")
    const cur = map.get(cid)
    if (!cur) continue
    if (st === CAMPAIGN_MESSAGE_STATUS_SENT) cur.sent++
    else if (NOT_SENT_STATUS_SET.has(st)) cur.notSent++
  }

  return map
}
