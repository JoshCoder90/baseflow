import type { SupabaseClient } from "@supabase/supabase-js"
import { applyCampaignSendSchedule } from "@/lib/campaign-schedule"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"

/**
 * Inserts missing `campaign_messages`, schedules pending rows (`pending` → `queued` + `next_send_at`),
 * and marks the campaign active so the outbound worker / client triggers can send.
 */
export async function activateCampaignSending(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<
  | { ok: true; messagesInserted: number; messagesScheduled: number }
  | { ok: false; error: string; status?: number }
> {
  const { data: campaign, error: campaignFetchError } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single()

  if (campaignFetchError || !campaign) {
    return { ok: false, error: "Campaign not found", status: 404 }
  }

  const { messagesInserted, messagesScheduled } = await applyCampaignSendSchedule(
    supabase,
    campaignId
  )

  const { error: activeErr } = await supabase
    .from("campaigns")
    .update({ status: "active", channel: OUTBOUND_EMAIL_CHANNEL })
    .eq("id", campaignId)
    .eq("user_id", userId)

  if (activeErr) {
    return {
      ok: false,
      error: activeErr.message ?? "Failed to update campaign",
      status: 500,
    }
  }

  console.log(
    "[activateCampaignSending] inserted:",
    messagesInserted,
    "scheduled:",
    messagesScheduled
  )

  return { ok: true, messagesInserted, messagesScheduled }
}
