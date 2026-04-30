/**
 * Import Gmail messages into `messages` when they belong to an existing CRM thread
 * (same Gmail thread_id as a stored message for this user's leads).
 * Imports both inbound (lead) and outbound (you) so BaseFlow matches Gmail threads.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type GmailMessageFull,
  extractEmailFromFromHeader,
  plainTextBodyFromGmailMessage,
} from "@/lib/gmail-inbound-parse"
import { bumpConversationLastMessage } from "@/lib/bump-conversation-last-message"

export type GmailSyncConnection = {
  id: string
  user_id: string
  gmail_email?: string | null
}

const MAX_DISTINCT_THREADS = 100
const LEAD_ID_CHUNK = 150

export async function gmailGetJson(
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
  cleaned = cleaned.split(/On\s.+wrote:/i)[0]
  cleaned = cleaned.split(/From:\s/i)[0]
  cleaned = cleaned.split(/Sent:\s/i)[0]
  cleaned = cleaned
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
  return cleaned.trim()
}

async function getDistinctThreadIdsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data: leads } = await supabase
    .from("leads")
    .select("id")
    .eq("user_id", userId)

  const leadIds = (leads ?? []).map((l) => l.id as string)
  const threadIds = new Set<string>()

  for (let i = 0; i < leadIds.length; i += LEAD_ID_CHUNK) {
    const chunk = leadIds.slice(i, i + LEAD_ID_CHUNK)
    if (chunk.length === 0) continue
    const { data: rows } = await supabase
      .from("messages")
      .select("thread_id")
      .in("lead_id", chunk)
      .not("thread_id", "is", null)
    for (const r of rows ?? []) {
      const t = (r as { thread_id: string }).thread_id
      if (t) threadIds.add(t)
    }
  }
  return [...threadIds]
}

async function resolveAnchorLeadId(
  supabase: SupabaseClient,
  threadId: string,
  ownerUserId: string
): Promise<string | null> {
  const { data: threadAnchor } = await supabase
    .from("messages")
    .select("lead_id")
    .eq("thread_id", threadId)
    .not("lead_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  const anchorLeadId = threadAnchor?.lead_id as string | undefined
  if (!anchorLeadId) return null

  const { data: owningLead, error: leadOwnErr } = await supabase
    .from("leads")
    .select("id, user_id")
    .eq("id", anchorLeadId)
    .maybeSingle()

  if (leadOwnErr || !owningLead || owningLead.user_id !== ownerUserId) {
    return null
  }
  return anchorLeadId
}

/**
 * When Gmail has no CRM row for this thread_id yet (e.g. they emailed first), match the sender to a lead by email.
 */
async function resolveLeadIdBySenderEmail(
  supabase: SupabaseClient,
  ownerUserId: string,
  fromEmail: string | null
): Promise<string | null> {
  if (!fromEmail?.trim()) return null
  const normalized = fromEmail.trim().toLowerCase()
  const PAGE = 500
  let offset = 0
  for (;;) {
    const { data: rows, error } = await supabase
      .from("leads")
      .select("id, email")
      .eq("user_id", ownerUserId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1)

    if (error) {
      console.warn("[gmail-crm-sync] resolveLeadIdBySenderEmail:", error.message)
      return null
    }
    const chunk = rows ?? []
    const hit = chunk.find(
      (r) => (r.email ?? "").trim().toLowerCase() === normalized
    )
    if (hit?.id) return hit.id as string
    if (chunk.length < PAGE) break
    offset += PAGE
  }
  return null
}

export async function importGmailMessageIntoCrm(
  supabase: SupabaseClient,
  gm: GmailMessageFull,
  connection: GmailSyncConnection
): Promise<"imported" | "skipped" | "duplicate"> {
  const gmailMessageId = gm.id
  if (!gmailMessageId) return "skipped"

  const { data: existingDup } = await supabase
    .from("messages")
    .select("id")
    .eq("gmail_message_id", gmailMessageId)
    .maybeSingle()

  if (existingDup) return "duplicate"

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

  const from = (fromHeader || "").toLowerCase()
  if (
    from.includes("mailer-daemon") ||
    from.includes("postmaster") ||
    body.toLowerCase().includes("delivery failed") ||
    body.toLowerCase().includes("not delivered") ||
    body.toLowerCase().includes("couldn't be delivered")
  ) {
    return "skipped"
  }

  if (!threadId) return "skipped"

  const myEmail = (connection.gmail_email ?? "").trim().toLowerCase()
  const isFromSelf = Boolean(
    fromEmail && myEmail && fromEmail.toLowerCase() === myEmail
  )

  const cleanedBody = cleanEmailReply(body)
  const content = (cleanedBody || body).trim() || "No content"

  let matchedLeadId = await resolveAnchorLeadId(
    supabase,
    threadId,
    connection.user_id
  )

  if (!matchedLeadId && !isFromSelf) {
    matchedLeadId = await resolveLeadIdBySenderEmail(
      supabase,
      connection.user_id,
      fromEmail
    )
  }

  if (!matchedLeadId) return "skipped"

  const role = isFromSelf ? "outbound" : "inbound"
  const internalMs = parseInt(String(gm.internalDate ?? "0"), 10)
  const messageAt =
    Number.isFinite(internalMs) && internalMs > 0
      ? new Date(internalMs).toISOString()
      : new Date().toISOString()

  if (isFromSelf) {
    const { data: orphan } = await supabase
      .from("messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("role", "outbound")
      .is("gmail_message_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orphan?.id) {
      const { error: upErr } = await supabase
        .from("messages")
        .update({ gmail_message_id: gmailMessageId })
        .eq("id", orphan.id as string)
      if (!upErr) {
        await bumpConversationLastMessage(supabase, {
          userId: connection.user_id,
          threadId,
          messageAt,
          lastMessageRole: "outbound",
        })
        return "imported"
      }
    }
  }

  const { error: insErr } = await supabase.from("messages").insert({
    role,
    content,
    thread_id: threadId,
    lead_id: matchedLeadId,
    gmail_message_id: gmailMessageId,
  })

  if (insErr) {
    console.error("[gmail-crm-sync] insert:", insErr)
    return "skipped"
  }

  await bumpConversationLastMessage(supabase, {
    userId: connection.user_id,
    threadId,
    messageAt,
    lastMessageRole: role === "outbound" ? "outbound" : "inbound",
  })

  console.log(
    `[gmail-crm-sync] inserted ${role} thread_id=${threadId} gmail_id=${gmailMessageId}`
  )
  return "imported"
}

/**
 * For every Gmail thread already linked in CRM, fetch the full thread and import any
 * missing messages (inbound + outbound). More reliable than scanning `in:inbox` only.
 */
export async function syncKnownCrmThreads(
  supabase: SupabaseClient,
  connection: GmailSyncConnection,
  accessToken: string
): Promise<number> {
  const threadIds = await getDistinctThreadIdsForUser(
    supabase,
    connection.user_id
  )
  let imported = 0
  const slice = threadIds.slice(0, MAX_DISTINCT_THREADS)

  for (const threadId of slice) {
    const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`
    const threadRes = await gmailGetJson(accessToken, threadUrl)
    if (!threadRes.ok) {
      console.warn(
        "[gmail-crm-sync] thread fetch failed:",
        threadId,
        threadRes.status
      )
      continue
    }
    const threadBody = threadRes.body as { messages?: GmailMessageFull[] }
    const msgs = threadBody.messages ?? []
    const sorted = [...msgs].sort((a, b) => {
      const ta = parseInt(String(a.internalDate ?? "0"), 10)
      const tb = parseInt(String(b.internalDate ?? "0"), 10)
      return ta - tb
    })
    for (const m of sorted) {
      const r = await importGmailMessageIntoCrm(supabase, m, connection)
      if (r === "imported") imported++
    }
  }
  return imported
}
