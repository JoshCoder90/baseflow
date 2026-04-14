/**
 * Batch processor for campaign_messages (legacy /api/queue and /api/send-messages).
 * One invocation per HTTP request — no internal setInterval.
 *
 * Toggle USE_REAL_QUEUE to switch between test and real queue (no schema changes).
 */

import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  refreshGmailAccessToken,
  isGmailReconnectRequiredError,
  clearGmailTokensForReconnect,
} from "@/lib/gmail-auth"
import { getAccountHealth } from "@/lib/account-health"
import { isValidEmail } from "@/lib/email-send-filter"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import { bumpConversationLastMessage } from "@/lib/bump-conversation-last-message"

/** Set to true to use real queue. Keep false for safe rollout. */
const USE_REAL_QUEUE = false

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

const BATCH_LIMIT = 5

let isProcessing = false

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type CampaignMessageJob = {
  id: string
  campaign_id: string
  lead_id: string
  message_body: string | null
  step_number: number
  send_at?: string | null
  next_send_at?: string | null
  status?: string | null
}

function sortTimeForCampaignMessage(m: CampaignMessageJob): number {
  if (m.status === "queued" && m.next_send_at) {
    return new Date(m.next_send_at).getTime()
  }
  return new Date(m.send_at ?? 0).getTime()
}

/** Ready to send: legacy `pending` + send_at, or started campaign `queued` + next_send_at. */
async function fetchReadyCampaignMessages(
  supabase: SupabaseClient,
  now: string,
  limit: number
): Promise<CampaignMessageJob[]> {
  const fields =
    "id, campaign_id, lead_id, message_body, step_number, send_at, next_send_at, status"

  const channelOr = `channel.eq.${OUTBOUND_EMAIL_CHANNEL},channel.is.null`

  const { data: pendingRows, error: errPending } = await supabase
    .from("campaign_messages")
    .select(fields)
    .eq("status", "pending")
    .or(channelOr)
    .lte("send_at", now)
    .order("send_at", { ascending: true })
    .limit(limit)

  const { data: queuedRows, error: errQueued } = await supabase
    .from("campaign_messages")
    .select(fields)
    .eq("status", "queued")
    .or(channelOr)
    .not("next_send_at", "is", null)
    .lte("next_send_at", now)
    .order("next_send_at", { ascending: true })
    .limit(limit)

  if (errPending) console.error("QUEUE FETCH ERROR (pending):", errPending)
  if (errQueued) console.error("QUEUE FETCH ERROR (queued):", errQueued)

  const merged = [...(pendingRows ?? []), ...(queuedRows ?? [])] as CampaignMessageJob[]
  merged.sort((a, b) => sortTimeForCampaignMessage(a) - sortTimeForCampaignMessage(b))
  return merged.slice(0, limit)
}

/** If this campaign has no rows with sent_at still null, mark the campaign completed. */
async function maybeMarkCampaignCompleted(
  supabase: SupabaseClient,
  campaignId: string
): Promise<void> {
  const { count, error } = await supabase
    .from("campaign_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .is("sent_at", null)

  if (error) {
    console.error("maybeMarkCampaignCompleted count error:", error)
    return
  }

  if (count !== 0) return

  const { error: upErr } = await supabase
    .from("campaigns")
    .update({ status: "completed" })
    .eq("id", campaignId)

  if (upErr) {
    console.error("maybeMarkCampaignCompleted update error:", upErr)
    return
  }

  console.log(`Campaign completed: ${campaignId}`)
}

async function sendViaGmail(
  accessToken: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<{ threadId?: string }> {
  const message = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    body,
  ].join("\r\n")

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodedMessage }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail API error: ${res.status} ${err}`)
  }

  const gmailResponse = (await res.json()) as { threadId?: string }
  return { threadId: gmailResponse.threadId }
}

async function processQueue_TEST(): Promise<number> {
  if (isProcessing) return 0
  if (!supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_KEY missing")
  }

  isProcessing = true
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const now = new Date().toISOString()

    const allPending = await fetchReadyCampaignMessages(supabase, now, BATCH_LIMIT)

    if (!allPending || allPending.length === 0) {
      return 0
    }

    console.log(`PROCESSING ${allPending.length} JOBS`)

    const campaignIds = [...new Set(allPending.map((m) => m.campaign_id))]
    const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, user_id, subject")
    .in("id", campaignIds)
    .in("status", ["active", "sending"])

    const campaignMap = new Map((campaigns ?? []).map((c) => [c.id, c]))
    const activeIds = new Set((campaigns ?? []).map((c) => c.id))
    const candidates = allPending.filter((m) => activeIds.has(m.campaign_id))

  const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"
  const userRemaining = new Map<string, number>()

  async function getRemainingForUser(userId: string): Promise<number> {
    if (userRemaining.has(userId)) {
      const r = userRemaining.get(userId)!
      if (r <= 0) return 0
      return r
    }
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    const { data: gmailConn } = await supabase
      .from("gmail_connections")
      .select("gmail_connected_at, created_at")
      .eq("user_id", userId)
      .maybeSingle()
    const { dailyLimit } = getAccountHealth({
      created_at: authUser?.user?.created_at,
      gmail_connected_at:
        (gmailConn?.gmail_connected_at as string | null | undefined) ??
        (gmailConn?.created_at as string | null | undefined),
    })
    const { data: userCampaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", userId)
    const userCampaignIds = (userCampaigns ?? []).map((c) => c.id)
    let sentToday = 0
    if (userCampaignIds.length > 0) {
      const { count } = await supabase
        .from("campaign_messages")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", userCampaignIds)
        .eq("status", "sent")
        .gte("sent_at", todayStart)
      sentToday = count ?? 0
    }
    const remaining = Math.max(0, dailyLimit - sentToday)
    userRemaining.set(userId, remaining)
    return remaining
  }

  const messagesToSend: typeof candidates = []
  for (const msg of candidates) {
    const campaign = campaignMap.get(msg.campaign_id)
    if (!campaign) continue
    const userId = campaign.user_id as string
    const remaining = await getRemainingForUser(userId)
    if (remaining <= 0) continue
    messagesToSend.push(msg)
    userRemaining.set(userId, remaining - 1)
  }

  let sentThisRun = 0
  for (const message of messagesToSend) {
    const campaign = campaignMap.get(message.campaign_id)
    if (!campaign) continue

    const { data: campRow } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", message.campaign_id)
      .single()
    const isCampaignActive =
      campRow?.status === "active" || campRow?.status === "sending"
    if (!isCampaignActive) break

    const userId = campaign.user_id as string
    const { data: gmailConn, error: gmailError } = await supabase
      .from("gmail_connections")
      .select("access_token, refresh_token, gmail_email, connected, gmail_connected_at, created_at")
      .eq("user_id", userId)
      .maybeSingle()

    console.log("GMAIL CONNECTION:", { data: gmailConn, error: gmailError })

    if (!gmailConn) {
      console.error("NO GMAIL CONNECTION FOUND for user", userId)
      await supabase
        .from("campaign_messages")
        .update({
          status: "failed",
          error_message: "No Gmail connected. Please connect Gmail in settings.",
        })
        .eq("id", message.id)
      continue
    }

    let accessToken = gmailConn.access_token as string | undefined
    if (gmailConn.refresh_token) {
      try {
        accessToken = await refreshGmailAccessToken(gmailConn.refresh_token)
        await supabase
          .from("gmail_connections")
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
      } catch (err) {
        if (isGmailReconnectRequiredError(err)) {
          console.log("Gmail connection expired, forcing reconnect")
          await clearGmailTokensForReconnect(supabase, userId)
          await supabase
            .from("campaign_messages")
            .update({
              status: "failed",
              error_message: "GMAIL_RECONNECT_REQUIRED",
            })
            .eq("id", message.id)
          continue
        }
        console.error("Gmail token refresh failed for user", userId, err)
        accessToken = gmailConn.access_token as string | undefined
      }
    }

    if (!accessToken) {
      console.error("NO ACCESS TOKEN for user", userId)
      await supabase
        .from("campaign_messages")
        .update({
          status: "failed",
          error_message: "Gmail token expired. Please reconnect Gmail.",
        })
        .eq("id", message.id)
      continue
    }

    const userEmail = gmailConn.gmail_email
    if (!userEmail) {
      console.error("NO GMAIL EMAIL for user", userId)
      await supabase
        .from("campaign_messages")
        .update({
          status: "failed",
          error_message: "Gmail email missing. Please reconnect Gmail.",
        })
        .eq("id", message.id)
      continue
    }

    const { data: lead } = await supabase
      .from("leads")
      .select("id, email, name, company, status, messages_sent, next_send_at")
      .eq("id", message.lead_id)
      .single()

    if (!lead || !lead.email) {
      await supabase
        .from("campaign_messages")
        .update({
          status: "failed",
          error_message: "Lead has no email address",
        })
        .eq("id", message.id)
      continue
    }

    const recipientCheck = await isValidEmail(lead.email)
    if (!recipientCheck.ok) {
      const errMsg =
        recipientCheck.reason === "filtered" ? "Filtered invalid email" : "Invalid domain"
      if (recipientCheck.reason === "filtered") {
        console.log(`Filtered out bad email: ${lead.email}`)
      } else {
        console.log(`Skipped invalid email: ${lead.email}`)
      }
      await supabase
        .from("campaign_messages")
        .update({
          status: "failed",
          error_message: errMsg,
        })
        .eq("id", message.id)
      await supabase
        .from("leads")
        .update({ status: "invalid_email", next_send_at: null })
        .eq("id", lead.id)
      continue
    }

    const text = message.message_body ?? ""
    const baseSubject = campaign.subject?.trim() || "Quick question"
    const subject =
      message.step_number > 1 ? `Re: ${baseSubject}` : baseSubject
    const htmlBody = text.includes("<") ? text : `<p>${text.replace(/\n/g, "<br />")}</p>`

    console.log("SENDING EMAIL TO:", message.lead_id)

    try {
      console.log("Sending static email (no personalization)")
      const { threadId } = await sendViaGmail(
        accessToken,
        userEmail,
        lead.email,
        subject,
        htmlBody
      )

      const sentAt = new Date().toISOString()
      const conversationContent =
        text.length > 0
          ? text
          : htmlBody.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim() || "(email)"

      const { error: insMsgErr } = await supabase.from("messages").insert({
        lead_id: lead.id,
        campaign_id: message.campaign_id,
        role: "outbound",
        content: conversationContent,
        created_at: sentAt,
        thread_id: threadId ?? null,
      })
      if (insMsgErr) {
        console.error("[process-queue-batch] messages insert:", insMsgErr)
      } else if (threadId) {
        await bumpConversationLastMessage(supabase, {
          userId,
          threadId,
          messageAt: sentAt,
          lastMessageRole: "outbound",
        })
      }

      await supabase
        .from("campaign_messages")
        .update({
          status: "sent",
          sent_at: sentAt,
        })
        .eq("id", message.id)

      const { error: updateError } = await supabase
        .from("leads")
        .update({
          status: "sent",
          next_send_at: null,
          messages_sent: 1,
        })
        .eq("id", lead.id)

      if (updateError) {
        console.error("❌ FAILED TO UPDATE LEAD:", updateError)
      } else {
        console.log("✅ UPDATED LEAD:", lead.id)
      }

      const { data: campaignRow } = await supabase
        .from("campaigns")
        .select("sent_count")
        .eq("id", message.campaign_id)
        .single()

      const { error: campaignError } = await supabase
        .from("campaigns")
        .update({
          sent_count: (campaignRow?.sent_count ?? 0) + 1,
        })
        .eq("id", message.campaign_id)

      if (campaignError) {
        console.error("❌ FAILED TO UPDATE CAMPAIGN:", campaignError)
      } else {
        console.log("✅ Campaign updated")
      }

      await maybeMarkCampaignCompleted(supabase, message.campaign_id)

      sentThisRun++
      console.log("SENT:", message.id)

      console.log("Waiting 30s before next send...")
      await delay(30000) // 30 seconds between emails
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error("SEND ERROR:", err)
      await supabase
        .from("campaign_messages")
        .update({
          status: "failed",
          error_message: errorMessage,
        })
        .eq("id", message.id)
    }
  }

    return sentThisRun
  } finally {
    isProcessing = false
  }
}

async function processQueue_REAL(): Promise<number> {
  if (isProcessing) return 0
  if (!supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_KEY missing")
  }

  console.log("REAL QUEUE START")
  isProcessing = true

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const now = new Date().toISOString()

    const jobs = await fetchReadyCampaignMessages(supabase, now, 10)

    if (!jobs?.length) {
      console.log("REAL QUEUE: No jobs found")
      return 0
    }

    let sentThisRun = 0
    for (const job of jobs) {
      try {
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("id, user_id, subject, status")
          .eq("id", job.campaign_id)
          .single()

        if (!campaign || (campaign.status !== "active" && campaign.status !== "sending")) {
          continue
        }

        const userId = campaign.user_id as string
        const { data: gmailConn } = await supabase
          .from("gmail_connections")
          .select("access_token, refresh_token, gmail_email")
          .eq("user_id", userId)
          .maybeSingle()

        if (!gmailConn) {
          await supabase
            .from("campaign_messages")
            .update({ status: "failed", error_message: "No Gmail connected" })
            .eq("id", job.id)
          continue
        }

        let accessToken = gmailConn.access_token as string | undefined
        if (gmailConn.refresh_token) {
          try {
            accessToken = await refreshGmailAccessToken(gmailConn.refresh_token)
            await supabase
              .from("gmail_connections")
              .update({ access_token: accessToken, updated_at: new Date().toISOString() })
              .eq("user_id", userId)
          } catch (err) {
            if (isGmailReconnectRequiredError(err)) {
              console.log("Gmail connection expired, forcing reconnect")
              await clearGmailTokensForReconnect(supabase, userId)
              await supabase
                .from("campaign_messages")
                .update({
                  status: "failed",
                  error_message: "GMAIL_RECONNECT_REQUIRED",
                })
                .eq("id", job.id)
              continue
            }
            accessToken = gmailConn.access_token as string | undefined
          }
        }

        if (!accessToken || !gmailConn.gmail_email) {
          await supabase
            .from("campaign_messages")
            .update({ status: "failed", error_message: "Gmail token invalid" })
            .eq("id", job.id)
          continue
        }

        const { data: lead } = await supabase
          .from("leads")
          .select("id, email, name, company, status, messages_sent, next_send_at")
          .eq("id", job.lead_id)
          .single()

        if (!lead?.email) {
          await supabase
            .from("campaign_messages")
            .update({ status: "failed", error_message: "Lead has no email" })
            .eq("id", job.id)
          continue
        }

        const recipientCheck = await isValidEmail(lead.email)
        if (!recipientCheck.ok) {
          const errMsg =
            recipientCheck.reason === "filtered" ? "Filtered invalid email" : "Invalid domain"
          if (recipientCheck.reason === "filtered") {
            console.log(`Filtered out bad email: ${lead.email}`)
          } else {
            console.log(`Skipped invalid email: ${lead.email}`)
          }
          await supabase
            .from("campaign_messages")
            .update({ status: "failed", error_message: errMsg })
            .eq("id", job.id)
          await supabase
            .from("leads")
            .update({ status: "invalid_email", next_send_at: null })
            .eq("id", lead.id)
          continue
        }

        const text = job.message_body ?? ""
        const baseSubject = campaign.subject?.trim() || "Quick question"
        const subject =
          job.step_number > 1 ? `Re: ${baseSubject}` : baseSubject
        const htmlBody = text.includes("<") ? text : `<p>${text.replace(/\n/g, "<br />")}</p>`

        console.log("Sending static email (no personalization)")
        const { threadId } = await sendViaGmail(
          accessToken,
          gmailConn.gmail_email,
          lead.email,
          subject,
          htmlBody
        )

        const sentAt = new Date().toISOString()
        const conversationContent =
          text.length > 0
            ? text
            : htmlBody.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim() || "(email)"

        const { error: insJobErr } = await supabase.from("messages").insert({
          lead_id: lead.id,
          campaign_id: job.campaign_id,
          role: "outbound",
          content: conversationContent,
          created_at: sentAt,
          thread_id: threadId ?? null,
        })
        if (insJobErr) {
          console.error("[process-queue-batch REAL] messages insert:", insJobErr)
        } else if (threadId) {
          await bumpConversationLastMessage(supabase, {
            userId,
            threadId,
            messageAt: sentAt,
            lastMessageRole: "outbound",
          })
        }

        await supabase
          .from("campaign_messages")
          .update({ status: "sent", sent_at: sentAt })
          .eq("id", job.id)

        const { error: updateError } = await supabase
          .from("leads")
          .update({
            status: "sent",
            next_send_at: null,
            messages_sent: 1,
          })
          .eq("id", lead.id)

        if (updateError) {
          console.error("❌ FAILED TO UPDATE LEAD:", updateError)
        } else {
          console.log("✅ UPDATED LEAD:", lead.id)
        }

        const { data: campaignRow } = await supabase
          .from("campaigns")
          .select("sent_count")
          .eq("id", job.campaign_id)
          .single()

        const { error: campaignError } = await supabase
          .from("campaigns")
          .update({
            sent_count: (campaignRow?.sent_count ?? 0) + 1,
          })
          .eq("id", job.campaign_id)

        if (campaignError) {
          console.error("❌ FAILED TO UPDATE CAMPAIGN:", campaignError)
        } else {
          console.log("✅ Campaign updated")
        }

        await maybeMarkCampaignCompleted(supabase, job.campaign_id)

        sentThisRun++
        console.log("REAL QUEUE SUCCESS:", lead.email)

        console.log("Waiting 30s before next send...")
        await delay(30000) // 30 seconds between emails
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("REAL QUEUE FAILED:", msg)
        await supabase
          .from("campaign_messages")
          .update({ status: "failed", error_message: msg })
          .eq("id", job.id)
      }
    }

    return sentThisRun
  } finally {
    isProcessing = false
  }
}

export async function processQueue(): Promise<number> {
  if (USE_REAL_QUEUE) {
    return processQueue_REAL()
  }
  return processQueue_TEST()
}
