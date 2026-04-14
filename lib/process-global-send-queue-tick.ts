/**
 * Picks exactly ONE due campaign_message across all active campaigns (earliest next_send_at),
 * claims it (queued → sending), then sends. No frontend required.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import { executeClaimedCampaignMessageSend } from "@/lib/execute-campaign-message-send"
import type { ClaimedCampaignMessageRow } from "@/lib/get-next-campaign-message"
import { revertCampaignMessageToQueued } from "@/lib/get-next-campaign-message"
import {
  DAILY_MAILBOX_SEND_CAP,
  countMailboxSendsRolling24h,
  getMailboxEmailForUser,
} from "@/lib/mailbox-daily-send-cap"

const SELECT_FIELDS =
  "id, campaign_id, lead_id, step_number, message_body, status, next_send_at, sent_at" as const

const MAX_ACTIVE_CAMPAIGN_IDS = 500
/** Scan past due rows whose mailbox is at cap so other mailboxes can still send. */
const DUE_CANDIDATE_SCAN_LIMIT = 40

export type GlobalTickResult = {
  success: true
  processed: number
  campaignId?: string
  /** Set when a row was claimed and send was attempted */
  messageId?: string
  campaignStatus?: string | null
  skipped?: boolean
  reason?: string
  rejected?: boolean
}

/**
 * Equivalent intent:
 * SELECT * FROM campaign_messages m
 * JOIN campaigns c ON c.id = m.campaign_id AND c.status = 'active'
 * WHERE m.status = 'queued' AND m.next_send_at <= NOW() ...
 * ORDER BY m.next_send_at ASC LIMIT 1
 */
export async function processGlobalSingleQueuedSend(
  supabase: SupabaseClient
): Promise<GlobalTickResult> {
  const nowIso = new Date().toISOString()
  const channelOr = `channel.eq.${OUTBOUND_EMAIL_CHANNEL},channel.is.null`

  const { data: activeCampaigns, error: actErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("status", "active")
    .limit(MAX_ACTIVE_CAMPAIGN_IDS)

  if (actErr) {
    console.error("[global-send-tick] active campaigns:", actErr)
    return {
      success: true,
      processed: 0,
      skipped: true,
      reason: "active_campaigns_query_failed",
    }
  }

  const activeIds = (activeCampaigns ?? []).map((r) => r.id as string).filter(Boolean)
  if (activeIds.length === 0) {
    return { success: true, processed: 0, skipped: true, reason: "no_active_campaigns" }
  }

  const { data: sendingRows } = await supabase
    .from("campaign_messages")
    .select("campaign_id")
    .eq("status", "sending")

  const busyCampaigns = new Set(
    (sendingRows ?? []).map((r) => r.campaign_id as string).filter(Boolean)
  )
  const eligibleCampaignIds = activeIds.filter((id) => !busyCampaigns.has(id))
  if (eligibleCampaignIds.length === 0) {
    return {
      success: true,
      processed: 0,
      skipped: true,
      reason: "all_active_campaigns_busy_sending",
    }
  }

  const { data: candidates, error: candErr } = await supabase
    .from("campaign_messages")
    .select(SELECT_FIELDS)
    .eq("status", "queued")
    .in("campaign_id", eligibleCampaignIds)
    .or(channelOr)
    .not("next_send_at", "is", null)
    .lte("next_send_at", nowIso)
    .is("sent_at", null)
    .order("next_send_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(DUE_CANDIDATE_SCAN_LIMIT)

  if (candErr) {
    console.error("[global-send-tick] candidate query:", candErr)
    return {
      success: true,
      processed: 0,
      skipped: true,
      reason: "candidate_query_failed",
    }
  }

  const dueList = (candidates ?? []) as ClaimedCampaignMessageRow[]
  if (dueList.length === 0) {
    return { success: true, processed: 0, skipped: true, reason: "no_due_message" }
  }

  const campaignIdsForDue = [...new Set(dueList.map((r) => r.campaign_id).filter(Boolean))]
  const { data: campaignOwners, error: ownErr } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .in("id", campaignIdsForDue)

  if (ownErr) {
    console.error("[global-send-tick] campaign owners:", ownErr)
    return {
      success: true,
      processed: 0,
      skipped: true,
      reason: "campaign_owners_query_failed",
    }
  }

  const userIdByCampaignId = new Map(
    (campaignOwners ?? []).map((r) => [r.id as string, r.user_id as string])
  )

  const mailboxByUserId = new Map<string, string | null>()
  const sendCountByMailbox = new Map<string, number>()
  const capLoggedForMailbox = new Set<string>()

  let candidate: ClaimedCampaignMessageRow | undefined
  for (const row of dueList) {
    const uid = userIdByCampaignId.get(row.campaign_id)
    if (!uid) continue

    let mailbox = mailboxByUserId.get(uid)
    if (mailbox === undefined) {
      mailbox = await getMailboxEmailForUser(supabase, uid)
      mailboxByUserId.set(uid, mailbox)
    }

    if (!mailbox) continue

    let sentInWindow = sendCountByMailbox.get(mailbox)
    if (sentInWindow === undefined) {
      sentInWindow = await countMailboxSendsRolling24h(supabase, mailbox)
      sendCountByMailbox.set(mailbox, sentInWindow)
    }

    if (sentInWindow >= DAILY_MAILBOX_SEND_CAP) {
      if (!capLoggedForMailbox.has(mailbox)) {
        capLoggedForMailbox.add(mailbox)
        console.log("Daily cap hit for mailbox:", mailbox)
      }
      continue
    }

    candidate = row
    break
  }

  if (!candidate?.id) {
    return {
      success: true,
      processed: 0,
      skipped: true,
      reason: "no_eligible_message_mailbox_cap_or_no_mailbox",
    }
  }

  const { data: claimed, error: claimErr } = await supabase
    .from("campaign_messages")
    .update({ status: "sending" })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .select(SELECT_FIELDS)
    .maybeSingle()

  if (claimErr || !claimed) {
    return { success: true, processed: 0, skipped: true, reason: "claim_lost_race" }
  }

  const claimedRow = claimed as ClaimedCampaignMessageRow
  const campaignId = claimedRow.campaign_id

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, user_id, subject, status")
    .eq("id", campaignId)
    .single()

  if (campErr || !campaign || campaign.status !== "active") {
    await revertCampaignMessageToQueued(
      supabase,
      claimedRow.id,
      claimedRow.next_send_at
    )
    return {
      success: true,
      processed: 0,
      skipped: true,
      reason: "campaign_no_longer_active",
    }
  }

  const exec = await executeClaimedCampaignMessageSend(supabase, {
    campaignId,
    ownerUserId: campaign.user_id as string,
    subject: campaign.subject as string | null,
    claimed: claimedRow,
  })

  return {
    success: true,
    processed: exec.processed,
    campaignId,
    messageId: claimedRow.id,
    campaignStatus: exec.campaignStatus,
    rejected: exec.rejected,
  }
}
