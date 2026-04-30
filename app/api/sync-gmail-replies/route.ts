let isRunning = false;

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { refreshGmailAccessToken } from "@/lib/gmail-auth"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  consumeRateLimit,
  RATE_LIMIT,
  tooManyRequestsJson,
} from "@/lib/rate-limit-policy"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import {
  type GmailMessageFull,
} from "@/lib/gmail-inbound-parse"
import {
  gmailGetJson,
  importGmailMessageIntoCrm,
  syncKnownCrmThreads,
} from "@/lib/gmail-crm-sync"

let lastRun = 0

export const dynamic = "force-dynamic"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

const GMAIL_LIST = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
const MAX_LIST = 100
const MAX_FULL_FETCH = 100

/**
 * Sync Gmail into CRM `messages`: (1) full fetch for every thread already linked in the DB,
 * (2) scan `in:inbox` for anything missed. Imports inbound replies and your outbound Gmail sends
 * when the thread matches a lead. Requires gmail.readonly (reconnect if scopes changed).
 */
type GmailConnectionRow = {
  id: string
  user_id: string
  access_token?: string | null
  refresh_token?: string | null
  gmail_email?: string | null
}

async function handleSync(): Promise<NextResponse> {
  try {
    if (!supabaseServiceKey) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: connections, error } = await supabase
      .from("gmail_connections")
      .select("*")

    if (error) {
      console.error("[sync-gmail-replies] gmail_connections:", error.message)
    }

    if (!connections?.length) {
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

    let totalImported = 0
    let totalListed = 0
    let totalChecked = 0
    let lastListError: {
      status: number
      body: unknown
    } | null = null

    for (const raw of connections) {
      const connection = raw as GmailConnectionRow
      let accessToken = connection.access_token as string | undefined

      if (connection.refresh_token) {
        try {
          accessToken = await refreshGmailAccessToken(connection.refresh_token as string)
          await supabase
            .from("gmail_connections")
            .update({
              access_token: accessToken,
              updated_at: new Date().toISOString(),
            })
            .eq("id", connection.id)
        } catch (e) {
          console.error("[sync-gmail-replies] token refresh:", connection.id, e)
          continue
        }
      }

      if (!accessToken) {
        console.warn("[sync-gmail-replies] skipping connection without token:", connection.id)
        continue
      }

      const syncConn = {
        id: connection.id,
        user_id: connection.user_id,
        gmail_email: connection.gmail_email,
      }

      const importedFromThreads = await syncKnownCrmThreads(
        supabase,
        syncConn,
        accessToken
      )
      totalImported += importedFromThreads

      const listParams = new URLSearchParams({
        q: "in:inbox",
        maxResults: String(MAX_LIST),
      })
      const listUrl = `${GMAIL_LIST}?${listParams.toString()}`
      const listRes = await gmailGetJson(accessToken, listUrl)

      const nowIso = new Date().toISOString()

      if (!listRes.ok) {
        lastListError = { status: listRes.status, body: listRes.body }
        console.error(
          "[sync-gmail-replies] inbox list failed:",
          connection.user_id,
          listRes.status
        )
        await supabase
          .from("gmail_connections")
          .update({ gmail_replies_synced_at: nowIso })
          .eq("id", connection.id)
        continue
      }

      const listPayload = listRes.body as {
        messages?: { id: string }[]
      }
      const rawIds = (listPayload.messages ?? []).map((m) => m.id).filter(Boolean)
      totalListed += rawIds.length

      if (rawIds.length === 0) {
        await supabase
          .from("gmail_connections")
          .update({ gmail_replies_synced_at: nowIso })
          .eq("id", connection.id)
        continue
      }

      const toFetch = rawIds.slice(0, MAX_FULL_FETCH)
      totalChecked += toFetch.length

      for (const msgId of toFetch) {
        const fullUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}?format=full`
        const fullRes = await gmailGetJson(accessToken, fullUrl)
        if (!fullRes.ok) continue

        const gm = fullRes.body as GmailMessageFull
        if (!gm.id) continue

        const r = await importGmailMessageIntoCrm(supabase, gm, syncConn)
        if (r === "imported") totalImported++
      }

      await supabase
        .from("gmail_connections")
        .update({ gmail_replies_synced_at: nowIso })
        .eq("id", connection.id)
    }

    if (totalImported === 0 && totalListed === 0 && lastListError) {
      const errBody = lastListError.body as {
        error?: { message?: string; status?: string }
      } | null
      const msg =
        errBody?.error?.message ??
        `Gmail list failed (${lastListError.status})`
      const needsScope =
        lastListError.status === 403 ||
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

    return NextResponse.json({
      success: true,
      imported: totalImported,
      checked: totalChecked,
      listed: totalListed,
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

  if (isRunning) {
    console.log("[SYNC BLOCKED] Already running")
    return NextResponse.json({ skipped: true })
  }
  isRunning = true
  try {
    return await handleSync()
  } finally {
    isRunning = false
  }
}

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "sync-gmail-replies")
  if (_ip) return _ip

  const limited = await rateLimitGmailSyncIfNeeded(req)
  if (limited) return limited

  if (isRunning) {
    console.log("[SYNC BLOCKED] Already running")
    return Response.json({ skipped: true })
  }

  isRunning = true

  try {
    const now = Date.now()
    if (now - lastRun < 55_000) {
      return Response.json({ skipped: true, reason: "too_soon" })
    }
    lastRun = now

    const syncRes = await handleSync()
    return syncRes
  } catch (err) {
    console.error("SYNC ERROR:", err);
    return Response.json({ error: true });
  } finally {
    isRunning = false;
  }
}
