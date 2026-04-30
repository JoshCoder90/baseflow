import type { SupabaseClient } from "@supabase/supabase-js"
import {
  refreshGmailAccessToken,
  isGmailReconnectRequiredError,
  clearGmailTokensForReconnect,
} from "@/lib/gmail-auth"
import {
  countUserDailyUsage,
  DAILY_USAGE_HARD_LIMIT,
} from "@/lib/daily-usage-limit"
import { isValidEmail } from "@/lib/email-send-filter"

async function sendViaGmail(
  accessToken: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  html: string
): Promise<{ threadId?: string; gmailMessageId?: string }> {
  const message = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n")

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

  console.log("Sending email to:", toEmail)
  console.log("Subject:", subject)

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

  const response = (await res.json()) as {
    id?: string
    threadId?: string
    data?: { threadId?: string }
  }
  console.log("Email sent successfully")
  console.log("Gmail response:", response)

  const threadId = response.data?.threadId ?? response.threadId
  const gmailMessageId = response.id
  return { threadId, gmailMessageId }
}

export type SendOutboundEmailViaGmailResult =
  | { ok: true; threadId?: string; gmailMessageId?: string }
  | {
      ok: false
      status: number
      error: string
    }

/**
 * Sends one outbound email via the user's Gmail connection using the service-role client.
 * Used by the HTTP route and by campaign cron so sends do not depend on internal HTTP fetch or cookie auth.
 */
export async function sendOutboundEmailViaGmailServiceRole(
  supabase: SupabaseClient,
  params: {
    ownerUserId: string
    toEmail: string
    subject: string
    html: string
  }
): Promise<SendOutboundEmailViaGmailResult> {
  const { ownerUserId, toEmail, subject, html } = params

  const n = await countUserDailyUsage(supabase, ownerUserId)
  if (n !== null && n >= DAILY_USAGE_HARD_LIMIT) {
    return {
      ok: false,
      status: 429,
      error: "Daily usage limit reached",
    }
  }
  if (n === null) {
    console.warn("[send-email-via-gmail] daily usage count unavailable, allowing send")
  }

  const { data: connection, error: connError } = await supabase
    .from("gmail_connections")
    .select("access_token, refresh_token, gmail_email, connected")
    .eq("user_id", ownerUserId)
    .maybeSingle()

  if (connError || !connection) {
    return {
      ok: false,
      status: 400,
      error: "Connect Gmail in settings to send emails",
    }
  }

  if (!connection.gmail_email || connection.connected !== true) {
    return {
      ok: false,
      status: 400,
      error: "Gmail not connected. Please reconnect in settings.",
    }
  }

  let accessToken = connection.access_token as string | undefined
  if (connection.refresh_token) {
    try {
      accessToken = await refreshGmailAccessToken(connection.refresh_token)
      await supabase
        .from("gmail_connections")
        .update({ access_token: accessToken, updated_at: new Date().toISOString() })
        .eq("user_id", ownerUserId)
    } catch (e) {
      if (isGmailReconnectRequiredError(e)) {
        console.log("Gmail connection expired, forcing reconnect")
        await clearGmailTokensForReconnect(supabase, ownerUserId)
        return { ok: false, status: 400, error: "GMAIL_RECONNECT_REQUIRED" }
      }
      console.error("Gmail token refresh failed:", e)
    }
  }

  if (!accessToken) {
    return {
      ok: false,
      status: 400,
      error: "Gmail token expired. Please reconnect Gmail.",
    }
  }

  const recipientCheck = await isValidEmail(String(toEmail))
  if (!recipientCheck.ok) {
    if (recipientCheck.reason === "filtered") {
      console.log(`Filtered out bad email: ${toEmail}`)
      return { ok: false, status: 400, error: "Filtered invalid email" }
    }
    console.log(`Skipped invalid email: ${toEmail}`)
    return { ok: false, status: 400, error: "Invalid domain" }
  }

  try {
    const gmailSend = await sendViaGmail(
      accessToken,
      connection.gmail_email,
      toEmail,
      subject,
      html
    )
    return {
      ok: true,
      threadId: gmailSend.threadId,
      gmailMessageId: gmailSend.gmailMessageId,
    }
  } catch (err) {
    console.error("SEND EMAIL ERROR:", err)
    const message =
      err instanceof Error && err.message ? err.message : "Send failed"
    return { ok: false, status: 500, error: message }
  }
}
