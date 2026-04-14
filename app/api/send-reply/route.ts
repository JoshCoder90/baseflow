import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { google } from "googleapis"
import type { gmail_v1 } from "googleapis"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  refreshGmailAccessToken,
  isGmailReconnectRequiredError,
  clearGmailTokensForReconnect,
} from "@/lib/gmail-auth"
import {
  INPUT_MAX,
  validateOptionalSecretString,
  validateText,
} from "@/lib/api-input-validation"
import { dailyUsageLimitResponseIfExceeded } from "@/lib/daily-usage-limit"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { rateLimitResponse } from "@/lib/rateLimit"
import { isValidEmail } from "@/lib/email-send-filter"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

type Body = {
  to?: string
  subject?: string
  message?: string
  accessToken?: string
  threadId?: string
}

function headerFromPayload(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | undefined {
  if (!headers?.length) return undefined
  const want = name.toLowerCase()
  const h = headers.find((x) => (x.name ?? "").toLowerCase() === want)
  const v = h?.value?.trim()
  return v || undefined
}

/** RFC 5322 reply subject from parent thread message. */
function replySubjectLine(parentSubject: string | undefined, clientSubject: string): string {
  const p = parentSubject?.trim()
  if (p) {
    if (/^re:\s*/i.test(p)) return p
    return `Re: ${p}`
  }
  return clientSubject.trim() || "Re:"
}

/**
 * Latest message in a Gmail thread (ordered by internalDate ascending) — use its
 * Message-ID / References for proper client threading. Gmail threadId is not a valid Message-ID.
 */
async function replyContextFromThread(
  gmail: gmail_v1.Gmail,
  threadId: string
): Promise<{
  inReplyTo?: string
  references?: string
  subjectForReply?: string
}> {
  try {
    const { data: thread } = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
    })
    const msgs = thread.messages ?? []
    if (msgs.length === 0) return {}
    const last = msgs[msgs.length - 1]
    if (!last.id) return {}

    const { data: msg } = await gmail.users.messages.get({
      userId: "me",
      id: last.id,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References", "Subject"],
    })

    const headers = msg.payload?.headers ?? []
    const messageId = headerFromPayload(headers, "Message-ID")
    const prevRefs = headerFromPayload(headers, "References")
    const subj = headerFromPayload(headers, "Subject")

    if (!messageId) {
      return { subjectForReply: subj }
    }

    const references = prevRefs ? `${prevRefs} ${messageId}`.trim() : messageId
    return {
      inReplyTo: messageId,
      references,
      subjectForReply: subj,
    }
  } catch (e) {
    console.warn("[send-reply] thread metadata fetch failed:", e)
    return {}
  }
}

export async function POST(req: NextRequest) {
  const _ip = heavyRouteIpLimitResponse(req, "send-reply")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { to, subject, message, threadId } = body
  let { accessToken } = body

  const vTo = validateText(to, {
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
  const vMsg = validateText(message, {
    required: true,
    maxLen: INPUT_MAX.long,
    field: "message",
  })
  if (!vMsg.ok) return vMsg.response
  const vThread = validateText(threadId, {
    required: false,
    maxLen: INPUT_MAX.threadId,
    field: "threadId",
  })
  if (!vThread.ok) return vThread.response
  const vTok = validateOptionalSecretString(
    accessToken,
    INPUT_MAX.token,
    "accessToken"
  )
  if (!vTok.ok) return vTok.response
  accessToken = vTok.value ?? undefined

  const toEmail = vTo.value
  const recipientCheck = await isValidEmail(toEmail)
  if (!recipientCheck.ok) {
    return NextResponse.json(
      {
        error:
          recipientCheck.reason === "filtered" ? "Filtered invalid email" : "Invalid email",
      },
      { status: 400 }
    )
  }

  let fromEmail: string | undefined

  if (!accessToken) {
    const serverClient = await createServerClient()
    const {
      data: { user },
    } = await serverClient.auth.getUser()
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: connection, error: connError } = await supabase
      .from("gmail_connections")
      .select("access_token, refresh_token, gmail_email, connected")
      .eq("user_id", user.id)
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

    fromEmail = connection.gmail_email as string
    accessToken = connection.access_token as string | undefined
    if (connection.refresh_token) {
      try {
        accessToken = await refreshGmailAccessToken(connection.refresh_token as string)
        await supabase
          .from("gmail_connections")
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq("user_id", user.id)
      } catch (e) {
        if (isGmailReconnectRequiredError(e)) {
          await clearGmailTokensForReconnect(supabase, user.id)
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
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "accessToken required or connect Gmail in settings" },
      { status: 400 }
    )
  }

  if (supabaseServiceKey) {
    const limitClient = await createServerClient()
    const {
      data: { user: limitUser },
    } = await limitClient.auth.getUser()
    if (limitUser?.id) {
      const supabaseLimit = createClient(supabaseUrl, supabaseServiceKey)
      const blocked = await dailyUsageLimitResponseIfExceeded(supabaseLimit, limitUser.id)
      if (blocked) return blocked
    }
  }

  try {
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })

    const gmail = google.gmail({ version: "v1", auth: oauth2Client })

    const tid = vThread.value
    const replyCtx =
      tid.length > 0 ? await replyContextFromThread(gmail, tid) : {}

    const subjectLine =
      tid.length > 0 && replyCtx.subjectForReply
        ? replySubjectLine(replyCtx.subjectForReply, vSub.value)
        : vSub.value

    const lines: string[] = [
      ...(fromEmail ? [`From: ${fromEmail}`] : []),
      `To: ${toEmail}`,
      `Subject: ${subjectLine}`,
    ]
    if (replyCtx.inReplyTo) {
      lines.push(`In-Reply-To: ${replyCtx.inReplyTo}`)
    }
    if (replyCtx.references) {
      lines.push(`References: ${replyCtx.references}`)
    }
    lines.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", vMsg.value)

    const rawMime = lines.join("\r\n")

    const encodedMessage = Buffer.from(rawMime)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

    const requestBody: { raw: string; threadId?: string } = { raw: encodedMessage }
    if (tid.length > 0) {
      requestBody.threadId = tid
    }

    const sendRes = await gmail.users.messages.send({
      userId: "me",
      requestBody,
    })

    return NextResponse.json({
      success: true,
      id: sendRes.data.id ?? undefined,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Failed to send" }, { status: 500 })
  }
}
