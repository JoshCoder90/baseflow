/**
 * Queue worker: processes campaign_messages queue and sends emails.
 * Called once per API request (/api/queue or /api/send-messages) — no internal loop.
 *
 * Toggle USE_REAL_QUEUE to switch between test and real queue (no schema changes).
 */

import { createClient } from "@supabase/supabase-js"
import { refreshGmailAccessToken } from "@/lib/gmail-auth"
import { getAccountHealth } from "@/lib/account-health"
import { personalizeMessage } from "@/lib/lead-personalization"

/** Set to true to use real queue. Keep false for safe rollout. */
const USE_REAL_QUEUE = false

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

const BATCH_LIMIT = 5

let isProcessing = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRandomDelay(): number {
  return Math.floor(45000 + Math.random() * 30000) // 45–75 seconds between sends
}

async function sendViaGmail(
  accessToken: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<void> {
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

    const { data: allPending, error } = await supabase
      .from("campaign_messages")
      .select("id, campaign_id, lead_id, message_body, step_number")
      .eq("status", "pending")
      .lte("send_at", now)
      .order("send_at", { ascending: true })
      .limit(BATCH_LIMIT)

    if (error) {
      console.error("QUEUE FETCH ERROR:", error)
      return 0
    }

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
      .select("*")
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

    const text = personalizeMessage(message.message_body ?? "", {
      name: lead?.name,
      company: lead?.company,
    })
    const baseSubject = campaign.subject?.trim() || "Quick question"
    const subject = message.step_number > 1 ? `Re: ${baseSubject}` : baseSubject
    const htmlBody = text.includes("<") ? text : `<p>${text.replace(/\n/g, "<br />")}</p>`

    console.log("SENDING EMAIL TO:", message.lead_id)

    try {
      console.log("Sending via Gmail:", userEmail, "->", lead.email)
      await sendViaGmail(
        accessToken,
        userEmail,
        lead.email,
        subject,
        htmlBody
      )

      await supabase
        .from("campaign_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", message.id)

      await supabase
        .from("leads")
        .update({
          status: "messaged",
          messages_sent: (lead.messages_sent ?? 0) + 1,
          last_message_sent_at: new Date().toISOString(),
        })
        .eq("id", lead.id)

      sentThisRun++
      console.log("SENT:", message.id)

      const delayMs = getRandomDelay()
      console.log("Waiting before next send:", delayMs, "ms")
      await sleep(delayMs)
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

    const { data: jobs, error } = await supabase
      .from("campaign_messages")
      .select("id, campaign_id, lead_id, message_body, step_number")
      .eq("status", "pending")
      .lte("send_at", now)
      .order("send_at", { ascending: true })
      .limit(10)

    if (error) {
      console.error("REAL QUEUE FETCH ERROR:", error)
      return 0
    }

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
          } catch {
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
          .select("*")
          .eq("id", job.lead_id)
          .single()

        if (!lead?.email) {
          await supabase
            .from("campaign_messages")
            .update({ status: "failed", error_message: "Lead has no email" })
            .eq("id", job.id)
          continue
        }

        const text = personalizeMessage(job.message_body ?? "", {
          name: lead?.name,
          company: lead?.company,
        })
        const baseSubject = campaign.subject?.trim() || "Quick question"
        const subject = job.step_number > 1 ? `Re: ${baseSubject}` : baseSubject
        const htmlBody = text.includes("<") ? text : `<p>${text.replace(/\n/g, "<br />")}</p>`

        console.log("REAL QUEUE: Sending to:", lead.email)
        await sendViaGmail(
          accessToken,
          gmailConn.gmail_email,
          lead.email,
          subject,
          htmlBody
        )

        await supabase
          .from("campaign_messages")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", job.id)

        await supabase
          .from("leads")
          .update({
            status: "messaged",
            messages_sent: (lead.messages_sent ?? 0) + 1,
            last_message_sent_at: new Date().toISOString(),
          })
          .eq("id", lead.id)

        sentThisRun++
        console.log("REAL QUEUE SUCCESS:", lead.email)

        const delayMs = getRandomDelay()
        console.log("Waiting before next send:", delayMs, "ms")
        await sleep(delayMs)
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
