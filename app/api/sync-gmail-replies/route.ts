let isRunning = false;

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  refreshGmailAccessToken,
  isGmailReconnectRequiredError,
} from "@/lib/gmail-auth"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  consumeRateLimit,
  RATE_LIMIT,
  tooManyRequestsJson,
} from "@/lib/rate-limit-policy"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import {
  type GmailMessageFull,
  extractEmailFromFromHeader,
  plainTextBodyFromGmailMessage,
} from "@/lib/gmail-inbound-parse"
import { startGmailSyncLoop } from "@/lib/gmail-sync-loop"
import { bumpConversationLastMessage } from "@/lib/bump-conversation-last-message"

let lastRun = 0

let hasStarted = false
if (!hasStarted) {
  hasStarted = true
  console.log("🚀 STARTING GMAIL SYNC LOOP...")
  startGmailSyncLoop()
}

export const dynamic = "force-dynamic"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

const GMAIL_LIST = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
const MAX_LIST = 100
const MAX_FULL_FETCH = 100

async function gmailGetJson(
  accessToken: string,
  url: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { ok: res.ok, status: res.status, body }
}

function cleanEmailReply(body: string) {
  if (!body) return body

  let cleaned = body

  // 1. Remove everything after "On ... wrote:"
  cleaned = cleaned.split(/On\s.+wrote:/i)[0]

  // 2. Remove everything after common separators
  cleaned = cleaned.split(/From:\s/i)[0]
  cleaned = cleaned.split(/Sent:\s/i)[0]

  // 3. Remove quoted lines starting with >
  cleaned = cleaned
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")

  // 4. Remove extra whitespace + empty lines
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")

  return cleaned.trim()
}

/**
 * Pull Gmail inbox (list q=in:inbox), fetch full messages, insert inbound rows only when the Gmail thread
 * already exists in CRM: a `messages` row with the same `thread_id` and a `lead_id` owned by this user.
 * Does not match by sender email or create leads — non-CRM mail is ignored. Inbox UI is DB-only.
 * Requires Gmail scope including gmail.readonly (users reconnect after scope change).
 */
async function handleSync(): Promise<NextResponse> {
  try {
    console.log("Starting Gmail sync...")
    console.log("SYNC ROUTE RUNNING")

    if (!supabaseServiceKey) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: connections, error } = await supabase
      .from("gmail_connections")
      .select("*")
      .limit(1)

    if (error) {
      console.error("[sync-gmail-replies] gmail_connections:", error.message)
    }

    if (!connections || connections.length === 0) {
      console.log("No Gmail connections found at all")
      return NextResponse.json(
        {
          success: true,
          skipped: true,
          reason: "no_gmail_connection",
          imported: 0,
        },
        { status: 200 }
      )
    }

    const connection = connections[0] as {
      id: string
      user_id: string
      access_token?: string | null
      refresh_token?: string | null
      gmail_email?: string | null
      connected?: boolean | null
      gmail_replies_synced_at?: string | null
    }

    console.log("Using Gmail connection:", connection.gmail_email)

    let accessToken = connection.access_token as string | undefined
    let reconnectRequired = false
    if (connection.refresh_token) {
      try {
        accessToken = await refreshGmailAccessToken(connection.refresh_token as string)
        await supabase
          .from("gmail_connections")
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq("id", connection.id)
      } catch (e) {
        console.error("[sync-gmail-replies] token refresh:", e)
        if (isGmailReconnectRequiredError(e)) {
          reconnectRequired = true
        }
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        {
          error: reconnectRequired
            ? "GMAIL_RECONNECT_REQUIRED"
            : "Gmail token invalid. Reconnect Gmail in settings.",
        },
        { status: 400 }
      )
    }

    const listParams = new URLSearchParams({
      q: "in:inbox",
      maxResults: String(MAX_LIST),
    })
    const listUrl = `${GMAIL_LIST}?${listParams.toString()}`
    console.log("[sync-gmail-replies] gmail.users.messages.list equivalent:", listUrl.split("?")[0], {
      q: "in:inbox",
      maxResults: MAX_LIST,
    })

    const listRes = await gmailGetJson(accessToken, listUrl)
    if (!listRes.ok) {
      const errBody = listRes.body as { error?: { message?: string; status?: string } } | null
      const msg = errBody?.error?.message ?? `Gmail list failed (${listRes.status})`
      const needsScope =
        listRes.status === 403 ||
        (typeof msg === "string" && msg.toLowerCase().includes("insufficient"))
      return NextResponse.json(
        {
          error: needsScope
            ? "Gmail needs inbox permission. Disconnect and reconnect Gmail to grant read access."
            : msg,
          code: needsScope ? "gmail_scope" : "gmail_list_error",
        },
        { status: needsScope ? 403 : 502 }
      )
    }

    const listPayload = listRes.body as { messages?: { id: string }[]; nextPageToken?: string }
    const messages = listPayload.messages
    console.log("GMAIL RESPONSE:", messages?.length || 0)
    const rawIds = (listPayload.messages ?? []).map((m) => m.id).filter(Boolean)
    if (rawIds.length === 0) {
      await supabase
        .from("gmail_connections")
        .update({ gmail_replies_synced_at: new Date().toISOString() })
        .eq("id", connection.id)
      return NextResponse.json({ success: true, imported: 0, checked: 0 })
    }

    const toFetch = rawIds.slice(0, MAX_FULL_FETCH)

    let imported = 0
    const nowIso = new Date().toISOString()

    for (const msgId of toFetch) {
      const fullUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}?format=full`
      const fullRes = await gmailGetJson(accessToken, fullUrl)
      if (!fullRes.ok) {
        console.log("[sync-gmail-replies] messages.get failed for id:", msgId, fullRes.status)
        continue
      }

      const gm = fullRes.body as GmailMessageFull
      if (!gm.id) {
        console.log("[sync-gmail-replies] messages.get: missing id")
        continue
      }

      const gmailMessageId = gm.id

      const { data: existingDup } = await supabase
        .from("messages")
        .select("*")
        .eq("gmail_message_id", gmailMessageId)
        .maybeSingle()

      if (existingDup) {
        console.log("Skipping duplicate:", gmailMessageId)
        continue
      }

      const headerList = gm.payload?.headers ?? []
      const fromHeader =
        headerList.find((h) => h.name === "From")?.value || ""

      const threadId = gm.threadId ?? null
      const fromEmail = extractEmailFromFromHeader(fromHeader)
      const snippet = (gm as { snippet?: string }).snippet || ""
      const body =
        plainTextBodyFromGmailMessage(gm).trim() ||
        snippet.trim() ||
        "No content"

      const from = (fromHeader || "").toLowerCase() || ""

      if (
        from.includes("mailer-daemon") ||
        from.includes("postmaster") ||
        from.includes("no-reply") ||
        body.toLowerCase().includes("delivery failed") ||
        body.toLowerCase().includes("not delivered") ||
        body.toLowerCase().includes("couldn't be delivered")
      ) {
        console.log("Skipping system/bounce email")
        continue
      }

      const cleanedBody = cleanEmailReply(body)

      if (!threadId) {
        console.log("[sync-gmail-replies] skip: no Gmail threadId on message", gmailMessageId)
        continue
      }

      const myEmail = (connection.gmail_email ?? "").trim().toLowerCase()
      if (fromEmail && myEmail && fromEmail.toLowerCase() === myEmail) {
        console.log("[sync-gmail-replies] skip: message from connected account (already in CRM send path)")
        continue
      }

      const { data: threadAnchor } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", threadId)
        .not("lead_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()

      const anchorLeadId = threadAnchor?.lead_id as string | undefined
      if (!anchorLeadId) {
        console.log(
          "[sync-gmail-replies] skip: thread not in CRM (no messages with this thread_id + lead_id)",
          threadId
        )
        continue
      }

      const { data: owningLead, error: leadOwnErr } = await supabase
        .from("leads")
        .select("id, user_id")
        .eq("id", anchorLeadId)
        .maybeSingle()

      if (leadOwnErr || !owningLead || owningLead.user_id !== connection.user_id) {
        console.log(
          "[sync-gmail-replies] skip: thread lead missing or not owned by this Gmail user",
          threadId,
          anchorLeadId
        )
        continue
      }

      const matchedLeadId = anchorLeadId

      if (cleanedBody !== body) {
        console.log("CLEANING WORKED")
      } else {
        console.log("CLEANING FAILED OR NOT USED")
      }

      const messageAt = new Date().toISOString()
      const { error: insErr } = await supabase.from("messages").insert({
        role: "inbound",
        content: cleanedBody,
        thread_id: threadId,
        lead_id: matchedLeadId,
        gmail_message_id: gmailMessageId,
      })

      if (!insErr) {
        imported++
        console.log("[sync-gmail-replies] inserted inbound thread_id:", threadId)
        if (threadId && connection.user_id) {
          await bumpConversationLastMessage(supabase, {
            userId: connection.user_id,
            threadId,
            messageAt,
            lastMessageRole: "inbound",
          })
        }
      } else {
        console.error("[sync-gmail-replies] insert:", insErr)
      }
    }

    await supabase
      .from("gmail_connections")
      .update({ gmail_replies_synced_at: nowIso })
      .eq("id", connection.id)

    return NextResponse.json({
      success: true,
      imported,
      checked: toFetch.length,
      listed: rawIds.length,
    })
  } catch (err) {
    console.error("Sync error:", err)
    return NextResponse.json({ error: "sync failed" }, { status: 500 })
  }
}

function isInternalGmailSyncRequest(req: Request): boolean {
  const secret = process.env.GMAIL_SYNC_INTERNAL_SECRET?.trim()
  if (!secret) return false
  return req.headers.get("x-baseflow-gmail-sync-internal") === secret
}

async function rateLimitGmailSyncIfNeeded(req: Request): Promise<Response | null> {
  if (isInternalGmailSyncRequest(req)) {
    return null
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.id) {
    if (
      !consumeRateLimit(
        `bf:gmail_sync_manual:${user.id}`,
        RATE_LIMIT.gmailSyncManualPerUserPerMinute,
        60_000
      )
    ) {
      return tooManyRequestsJson(
        "Gmail sync limit reached (5 per minute). Try again shortly."
      )
    }
    return null
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  if (
    !consumeRateLimit(
      `bf:gmail_sync_unauth:${ip}`,
      RATE_LIMIT.gmailSyncUnauthenticatedPerIpPerMinute,
      60_000
    )
  ) {
    return tooManyRequestsJson("Too many requests", 429)
  }
  return null
}

export async function GET(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "sync-gmail-replies")
  if (_ip) return _ip

  const limited = await rateLimitGmailSyncIfNeeded(req)
  if (limited) return limited

  return handleSync()
}

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "sync-gmail-replies")
  if (_ip) return _ip

  const limited = await rateLimitGmailSyncIfNeeded(req)
  if (limited) return limited

  if (isRunning) {
    console.log("SYNC BLOCKED — already running");
    return Response.json({ skipped: true });
  }

  isRunning = true;

  try {
    console.log("SYNC START");

    const now = Date.now();
    if (now - lastRun < 10000) {
      console.log("Skipping sync — too soon");
      return Response.json({ skipped: true });
    }
    lastRun = now;

    await handleSync();

    console.log("SYNC END");
    return Response.json({ success: true });
  } catch (err) {
    console.error("SYNC ERROR:", err);
    return Response.json({ error: true });
  } finally {
    isRunning = false;
  }
}
