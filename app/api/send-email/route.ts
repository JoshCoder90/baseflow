import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  refreshGmailAccessToken,
  isGmailReconnectRequiredError,
  clearGmailTokensForReconnect,
} from "@/lib/gmail-auth"
import {
  INPUT_MAX,
  validateOptionalUuid,
  validateText,
} from "@/lib/api-input-validation"
import { dailyUsageLimitResponseIfExceeded } from "@/lib/daily-usage-limit"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { rateLimitResponse } from "@/lib/rateLimit"
import { isValidEmail } from "@/lib/email-send-filter"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

async function sendViaGmail(
  accessToken: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  html: string
): Promise<{ threadId?: string }> {
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
    threadId?: string
    data?: { threadId?: string }
  }
  console.log("Email sent successfully")
  console.log("Gmail response:", response)

  const threadId = response.data?.threadId ?? response.threadId
  return { threadId }
}

export async function POST(req: NextRequest) {
  const _ip = heavyRouteIpLimitResponse(req, "send-email")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    const body = await req.json()
    const { to, subject, html, userId: bodyUserId } = body

    const rawTo = Array.isArray(to) ? to[0] : to
    const vTo = validateText(rawTo, {
      required: true,
      maxLen: INPUT_MAX.email,
      field: "to",
    })
    if (!vTo.ok) return vTo.response
    const vSub = validateText(subject, {
      required: true,
      maxLen: INPUT_MAX.medium,
      field: "subject",
    })
    if (!vSub.ok) return vSub.response
    const vHtml = validateText(html, {
      required: true,
      maxLen: INPUT_MAX.long,
      field: "html",
    })
    if (!vHtml.ok) return vHtml.response
    const vUid = validateOptionalUuid(bodyUserId, "userId")
    if (!vUid.ok) return vUid.response

    const toEmail = vTo.value

    const serverClient = await createServerClient()

    const isInternalCall = true

    if (!isInternalCall) {
      const { data: { user } } = await serverClient.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

    const { data: { user: sessionUser } } = await serverClient.auth.getUser()
    const effectiveUserId = vUid.value ?? sessionUser?.id

    if (!effectiveUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const _dailyLimit = await dailyUsageLimitResponseIfExceeded(supabase, effectiveUserId)
    if (_dailyLimit) return _dailyLimit

    const { data: connection, error: connError } = await supabase
      .from("gmail_connections")
      .select("access_token, refresh_token, gmail_email, connected")
      .eq("user_id", effectiveUserId)
      .maybeSingle()

    if (connError || !connection) {
      return NextResponse.json(
        { error: "Connect Gmail in settings to send emails" },
        { status: 400 }
      )
    }

    if (!connection.gmail_email || connection.connected !== true) {
      return NextResponse.json(
        { error: "Gmail not connected. Please reconnect in settings." },
        { status: 400 }
      )
    }

    let accessToken = connection.access_token as string | undefined
    if (connection.refresh_token) {
      try {
        accessToken = await refreshGmailAccessToken(connection.refresh_token)
        await supabase
          .from("gmail_connections")
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq("user_id", effectiveUserId)
      } catch (e) {
        if (isGmailReconnectRequiredError(e)) {
          console.log("Gmail connection expired, forcing reconnect")
          await clearGmailTokensForReconnect(supabase, effectiveUserId)
          return NextResponse.json({ error: "GMAIL_RECONNECT_REQUIRED" }, { status: 400 })
        }
        console.error("Gmail token refresh failed:", e)
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Gmail token expired. Please reconnect Gmail." },
        { status: 400 }
      )
    }

    const recipientCheck = await isValidEmail(String(toEmail))
    if (!recipientCheck.ok) {
      if (recipientCheck.reason === "filtered") {
        console.log(`Filtered out bad email: ${toEmail}`)
        return NextResponse.json({ error: "Filtered invalid email" }, { status: 400 })
      }
      console.log(`Skipped invalid email: ${toEmail}`)
      return NextResponse.json({ error: "Invalid domain" }, { status: 400 })
    }

    const gmailSend = await sendViaGmail(
      accessToken,
      connection.gmail_email,
      toEmail,
      vSub.value,
      vHtml.value
    )

    return NextResponse.json({
      success: true,
      threadId: gmailSend.threadId,
    })
  } catch (err) {
    console.error("SEND EMAIL ERROR:", err)
    const message =
      err instanceof Error && err.message ? err.message : "Send failed"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
