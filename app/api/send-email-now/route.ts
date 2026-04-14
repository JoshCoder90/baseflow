import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { executeClaimedCampaignMessageSend } from "@/lib/execute-campaign-message-send"
import { getCampaign } from "@/lib/get-campaign"
import type { ClaimedCampaignMessageRow } from "@/lib/get-next-campaign-message"
import { revertCampaignMessageToQueued } from "@/lib/get-next-campaign-message"
import {
  getMailboxEmailForUser,
  isMailboxAtDailySendCap,
} from "@/lib/mailbox-daily-send-cap"
import { validateUuid } from "@/lib/api-input-validation"
import { dailyUsageLimitResponseIfExceeded } from "@/lib/daily-usage-limit"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

const SELECT_FIELDS =
  "id, campaign_id, lead_id, step_number, message_body, status, next_send_at, sent_at" as const

/**
 * User-triggered immediate send when the queue countdown hits zero.
 * Claims `queued` → `sending` (same as worker); worker skips non-queued rows.
 */
export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "send-email-now")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const serverClient = await createServerClient()
  const {
    data: { user },
  } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { messageId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const vm = validateUuid(body.messageId, "messageId")
  if (!vm.ok) return vm.response
  const messageId = vm.value

  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const _dailyLimit = await dailyUsageLimitResponseIfExceeded(supabase, user.id)
  if (_dailyLimit) return _dailyLimit

  const { data: msg, error: msgErr } = await supabase
    .from("campaign_messages")
    .select("id, campaign_id, status, next_send_at, sent_at")
    .eq("id", messageId)
    .maybeSingle()

  if (msgErr || !msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }

  if (msg.status !== "queued") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "not_queued",
      status: msg.status,
    })
  }

  if (msg.sent_at) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_sent" })
  }

  const campaignId = msg.campaign_id as string
  const campaign = await getCampaign(supabase, campaignId, user.id)
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  if (campaign.status !== "active" && campaign.status !== "sending") {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "campaign_not_active" },
      { status: 409 }
    )
  }

  const mailbox = await getMailboxEmailForUser(supabase, user.id)
  if (await isMailboxAtDailySendCap(supabase, mailbox)) {
    if (mailbox) {
      console.log("Daily cap hit for mailbox:", mailbox)
    }
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "daily_mailbox_send_cap",
    })
  }

  const { data: claimed, error: claimErr } = await supabase
    .from("campaign_messages")
    .update({ status: "sending" })
    .eq("id", messageId)
    .eq("status", "queued")
    .select(SELECT_FIELDS)
    .maybeSingle()

  if (claimErr || !claimed) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "claim_failed",
    })
  }

  const claimedRow = claimed as ClaimedCampaignMessageRow

  const { data: campFresh, error: freshErr } = await supabase
    .from("campaigns")
    .select("status, subject")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single()

  if (
    freshErr ||
    !campFresh ||
    (campFresh.status !== "active" && campFresh.status !== "sending")
  ) {
    await revertCampaignMessageToQueued(
      supabase,
      claimedRow.id,
      claimedRow.next_send_at
    )
    return NextResponse.json(
      { ok: false, skipped: true, reason: "campaign_not_active" },
      { status: 409 }
    )
  }

  const exec = await executeClaimedCampaignMessageSend(supabase, {
    campaignId,
    ownerUserId: user.id,
    subject: campFresh.subject as string | null,
    claimed: claimedRow,
  })

  return NextResponse.json({
    ok: true,
    skipped: false,
    processed: exec.processed,
    campaignStatus: exec.campaignStatus,
    rejected: exec.rejected,
  })
}
