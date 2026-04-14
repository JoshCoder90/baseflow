/**
 * Process at most one queued campaign_message for a single campaign (Gmail send + DB updates).
 * Used by POST /api/campaigns/[id]/process-send-queue (manual / legacy).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { executeClaimedCampaignMessageSend } from "@/lib/execute-campaign-message-send"
import { getNextCampaignMessage } from "@/lib/get-next-campaign-message"
import {
  getMailboxEmailForUser,
  isMailboxAtDailySendCap,
} from "@/lib/mailbox-daily-send-cap"

export type ProcessSendQueueResult = {
  success: true
  processed: number
  campaignStatus: string | null
  skipped?: boolean
  reason?: string
  rejected?: boolean
}

/**
 * @param authorizedUserId — if set, campaign must belong to this user (browser API).
 */
export async function processCampaignSendQueueOnce(
  supabase: SupabaseClient,
  campaignId: string,
  authorizedUserId?: string
): Promise<ProcessSendQueueResult> {
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, user_id, subject, status")
    .eq("id", campaignId)
    .single()

  if (campErr || !campaign) {
    return {
      success: true,
      processed: 0,
      campaignStatus: null,
      skipped: true,
      reason: "campaign_not_found",
    }
  }

  if (authorizedUserId && campaign.user_id !== authorizedUserId) {
    return {
      success: true,
      processed: 0,
      campaignStatus: campaign.status,
      skipped: true,
      reason: "forbidden",
    }
  }

  if (campaign.status !== "active") {
    return {
      success: true,
      processed: 0,
      campaignStatus: campaign.status,
      skipped: true,
      reason: "campaign_not_active",
    }
  }

  const ownerUserId = campaign.user_id as string

  const mailbox = await getMailboxEmailForUser(supabase, ownerUserId)
  if (await isMailboxAtDailySendCap(supabase, mailbox)) {
    if (mailbox) {
      console.log("Daily cap hit for mailbox:", mailbox)
    }
    return {
      success: true,
      processed: 0,
      campaignStatus: campaign.status,
      skipped: true,
      reason: "daily_mailbox_send_cap",
    }
  }

  await supabase.rpc("set_config", {
    setting: "timezone",
    value: "UTC",
  })

  const nowIso = new Date().toISOString()
  const message = await getNextCampaignMessage(supabase, campaignId, nowIso)

  if (!message) {
    return {
      success: true,
      processed: 0,
      campaignStatus: campaign.status,
    }
  }

  const exec = await executeClaimedCampaignMessageSend(supabase, {
    campaignId,
    ownerUserId,
    subject: campaign.subject,
    claimed: message,
  })

  return {
    success: true,
    processed: exec.processed,
    campaignStatus: exec.campaignStatus,
    rejected: exec.rejected,
  }
}
