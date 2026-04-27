import type { SupabaseClient } from "@supabase/supabase-js"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"

export type ClaimedCampaignMessageRow = {
  id: string
  campaign_id: string
  lead_id: string
  step_number: number
  message_body: string | null
  status: string | null
  next_send_at: string | null
  sent_at: string | null
}

const SELECT_FIELDS =
  "id, campaign_id, lead_id, step_number, message_body, status, next_send_at, sent_at" as const

export async function getNextCampaignMessage(
  supabase: SupabaseClient,
  campaignId: string,
  nowIso: string
): Promise<ClaimedCampaignMessageRow | null> {
  const { data, error } = await supabase.rpc("claim_next_campaign_message", {
    p_campaign_id: campaignId,
    p_now: nowIso,
  })

  if (!error) {
    const rows = Array.isArray(data) ? data : data != null ? [data] : []
    const row = rows[0] as ClaimedCampaignMessageRow | undefined
    if (row?.id) return row
    return null
  }

  const { count: sendingCount } = await supabase
    .from("campaign_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sending")

  if ((sendingCount ?? 0) > 0) {
    return null
  }

  const { data: candidates, error: fetchErr } = await supabase
    .from("campaign_messages")
    .select(SELECT_FIELDS)
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .or(`channel.eq.${OUTBOUND_EMAIL_CHANNEL},channel.is.null`)
    .not("next_send_at", "is", null)
    .lte("next_send_at", nowIso)
    .is("sent_at", null)
    .order("next_send_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)

  if (fetchErr || !candidates?.length) return null

  const candidate = candidates[0] as ClaimedCampaignMessageRow

  const claimedAt = new Date().toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from("campaign_messages")
    .update({ status: "sending", sending_claimed_at: claimedAt })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select(SELECT_FIELDS)
    .maybeSingle()

  if (claimErr || !claimed) return null
  return claimed as ClaimedCampaignMessageRow
}

export async function revertCampaignMessageToQueued(
  supabase: SupabaseClient,
  messageId: string,
  nextSendAt: string | null
): Promise<void> {
  await supabase
    .from("campaign_messages")
    .update({
      status: "queued",
      next_send_at: nextSendAt,
      sending_claimed_at: null,
    })
    .eq("id", messageId)
    .eq("status", "sending")
}
