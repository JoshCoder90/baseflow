import type { SupabaseClient } from "@supabase/supabase-js"
import { CAMPAIGN_SEND_GAP_MS } from "@/lib/campaign-send-schedule-constants"

/** Same parsing as `CampaignQueueTab` so server “due” matches UI countdown. */
export function parseCampaignNextSendAtMs(nextSendAt: string | null | undefined): number | null {
  if (!nextSendAt?.trim()) return null
  const t = nextSendAt.trim()
  const hasTz = /Z$/i.test(t) || /[+-]\d{2}:?\d{2}$/.test(t)
  const ms = new Date(hasTz ? t : `${t}Z`).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Extra wait time before another send for this campaign.
 *
 * When `messageNextSendAt` is already in the past (scheduled slot reached), returns **0**.
 * That aligns enforcement with the stagger grid from `applyCampaignSendSchedule`: the countdown is
 * authoritative. Otherwise we’d block the next lead until `last_sent + GAP` even when its
 * `next_send_at` slot has passed (e.g. first email went out late).
 *
 * If `messageNextSendAt` is missing, falls back to **min time since last `sent_at`** (burst guard).
 */
export async function getMsUntilCampaignSendGapElapsed(
  supabase: SupabaseClient,
  campaignId: string,
  options?: { messageNextSendAt?: string | null }
): Promise<number> {
  const slotMs = parseCampaignNextSendAtMs(options?.messageNextSendAt ?? null)
  const now = Date.now()
  if (slotMs !== null) {
    if (now < slotMs) {
      return slotMs - now
    }
    return 0
  }

  const { data, error } = await supabase
    .from("campaign_messages")
    .select("sent_at")
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn("[campaign-send-gap] latest sent_at query failed, allowing send:", error)
    return 0
  }
  if (!data?.sent_at) return 0
  const last = new Date(String(data.sent_at)).getTime()
  if (!Number.isFinite(last)) return 0
  const elapsed = Date.now() - last
  if (elapsed >= CAMPAIGN_SEND_GAP_MS) return 0
  return CAMPAIGN_SEND_GAP_MS - elapsed
}
