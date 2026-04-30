import type { SupabaseClient } from "@supabase/supabase-js"

type LeadRow = Record<string, unknown> & {
  id: string
  name?: string | null
  email?: string | null
}

type MsgRow = {
  lead_id?: string | null
  content?: string | null
  thread_id?: string | null
  created_at?: string | null
}

const LEAD_ID_IN_CHUNK = 120

function normalizeInboxEmail(email: unknown): string | null {
  if (typeof email !== "string") return null
  const t = email.trim().toLowerCase()
  if (!t || !t.includes("@")) return null
  return t
}

function maxMsgTimeForLeadIds(
  leadIds: Set<string>,
  allMessages: MsgRow[]
): number {
  let max = 0
  for (const m of allMessages) {
    const lid = m.lead_id as string | undefined
    if (!lid || !leadIds.has(lid)) continue
    const t = new Date(m.created_at ?? 0).getTime()
    if (t > max) max = t
  }
  return max
}

export type InboxLeadWithMerge = LeadRow & {
  last_message: string
  thread_id: string | null
  mergedLeadIds: string[]
}

/**
 * One inbox row per email — duplicate lead rows (same contact) merge into one thread.
 */
function mergeDuplicateLeadsForInbox(
  rows: Array<
    LeadRow & {
      last_message: string
      thread_id: string | null
    }
  >,
  allMessages: MsgRow[]
): InboxLeadWithMerge[] {
  const byEmail = new Map<
    string,
    Array<
      LeadRow & {
        last_message: string
        thread_id: string | null
      }
    >
  >()
  const noEmailKey: Array<
    LeadRow & {
      last_message: string
      thread_id: string | null
    }
  > = []

  for (const row of rows) {
    const key = normalizeInboxEmail(row.email)
    if (!key) {
      noEmailKey.push(row)
      continue
    }
    if (!byEmail.has(key)) byEmail.set(key, [])
    byEmail.get(key)!.push(row)
  }

  const merged: InboxLeadWithMerge[] = []

  for (const group of byEmail.values()) {
    if (group.length === 1) {
      const r = group[0]
      merged.push({
        ...r,
        mergedLeadIds: [r.id],
      })
      continue
    }

    const ids = group.map((g) => g.id)
    const idSet = new Set(ids)
    const groupMsgs = allMessages.filter(
      (m) => m.lead_id && idSet.has(m.lead_id as string)
    )
    const sortedMsgs = [...groupMsgs].sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime()
    )
    const newest = sortedMsgs[0]

    const canonical =
      group.find((g) => g.id === newest?.lead_id) ??
      [...group].sort(
        (a, b) =>
          new Date(String(b.created_at ?? 0)).getTime() -
          new Date(String(a.created_at ?? 0)).getTime()
      )[0]

    const previewRaw = newest?.content
    const preview =
      previewRaw != null && String(previewRaw).trim() !== ""
        ? String(previewRaw)
        : canonical.last_message

    const threadFromMsg =
      newest?.thread_id ??
      sortedMsgs.find((m) => m.thread_id)?.thread_id ??
      group.find((g) => g.thread_id)?.thread_id ??
      null

    const unread = group.some(
      (g) => (g as { unread?: boolean }).unread === true
    )

    merged.push({
      ...canonical,
      last_message: preview,
      thread_id: threadFromMsg ?? canonical.thread_id ?? null,
      unread,
      mergedLeadIds: ids,
    })
  }

  for (const row of noEmailKey) {
    merged.push({
      ...row,
      mergedLeadIds: [row.id],
    })
  }

  merged.sort(
    (a, b) =>
      maxMsgTimeForLeadIds(new Set(b.mergedLeadIds), allMessages) -
      maxMsgTimeForLeadIds(new Set(a.mergedLeadIds), allMessages)
  )

  return merged
}

/**
 * Load inbox leads + last preview / thread_id without scanning all `messages` rows.
 * A global `.select("*")` on messages hits the default row cap (~1000) on busy DBs,
 * so tenant rows never appear — empty inbox on Vercel.
 */
export async function fetchInboxLeadsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<InboxLeadWithMerge[]> {
  const { data: userLeads, error: leadsListErr } = await supabase
    .from("leads")
    .select("id")
    .eq("user_id", userId)

  if (leadsListErr) {
    console.error("[inbox] leads id list:", leadsListErr.message)
    return []
  }

  const leadIds = (userLeads ?? []).map((r) => r.id as string)
  if (leadIds.length === 0) return []

  const allMessages: MsgRow[] = []
  for (let i = 0; i < leadIds.length; i += LEAD_ID_IN_CHUNK) {
    const chunk = leadIds.slice(i, i + LEAD_ID_IN_CHUNK)
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("lead_id, content, thread_id, created_at")
      .in("lead_id", chunk)
      .order("created_at", { ascending: false })

    if (msgErr) {
      console.error("[inbox] messages for leads chunk:", msgErr.message)
      continue
    }
    allMessages.push(...((msgs ?? []) as MsgRow[]))
  }

  const leadIdsWithMessages = new Set(
    allMessages.map((m) => m.lead_id).filter(Boolean) as string[]
  )
  if (leadIdsWithMessages.size === 0) return []

  const sorted = [...allMessages].sort(
    (a, b) =>
      new Date(b.created_at ?? 0).getTime() -
      new Date(a.created_at ?? 0).getTime()
  )

  const metaByLead: Record<
    string,
    { last_message: string; thread_id: string | null }
  > = {}

  for (const row of sorted) {
    const lid = row.lead_id
    if (!lid) continue

    const preview =
      row.content != null && String(row.content).trim() !== ""
        ? String(row.content)
        : "(New message)"
    const tid = row.thread_id ?? null

    if (!metaByLead[lid]) {
      metaByLead[lid] = {
        last_message: preview,
        thread_id: tid,
      }
    } else if (!metaByLead[lid].thread_id && tid) {
      metaByLead[lid].thread_id = tid
    }
  }

  const leadIdArr = [...leadIdsWithMessages]
  const leadsRows: LeadRow[] = []
  const FETCH_CHUNK = 100
  for (let i = 0; i < leadIdArr.length; i += FETCH_CHUNK) {
    const slice = leadIdArr.slice(i, i + FETCH_CHUNK)
    const { data: batch, error: leadsErr } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .in("id", slice)
      .order("created_at", { ascending: false })

    if (leadsErr) {
      console.error("[inbox] leads full rows:", leadsErr.message)
      continue
    }
    leadsRows.push(...((batch ?? []) as LeadRow[]))
  }

  leadsRows.sort(
    (a, b) =>
      new Date(String(b.created_at ?? 0)).getTime() -
      new Date(String(a.created_at ?? 0)).getTime()
  )

  const expanded = leadsRows.map((lead) => {
    const row = lead as LeadRow
    const meta = metaByLead[row.id]
    return {
      ...row,
      last_message: meta?.last_message ?? "(New message)",
      thread_id: meta?.thread_id ?? null,
    }
  })

  return mergeDuplicateLeadsForInbox(expanded, allMessages)
}

const DASHBOARD_MSG_PAGE = 1000
const DASHBOARD_LEAD_CHUNK = 80
const DASHBOARD_TABLE_PAGE = 1000

async function fetchUserLeadIdsPaginated(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += DASHBOARD_TABLE_PAGE) {
    const to = from + DASHBOARD_TABLE_PAGE - 1
    const { data, error } = await supabase
      .from("leads")
      .select("id")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to)

    if (error) {
      console.error("[inbox-data] paginated lead ids:", error.message)
      return out
    }
    const chunk = data ?? []
    out.push(...chunk.map((r) => r.id as string))
    if (chunk.length < DASHBOARD_TABLE_PAGE) break
  }
  return out
}

/**
 * Full `messages` rows for `/dashboard/inbox` — scoped to the user's leads only.
 * Avoids the global messages scan + row cap that hid tenant data on production.
 */
export async function fetchAllMessagesForDashboardInbox(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  data: Record<string, unknown>[]
  error: { message: string } | null
}> {
  const leadIds = await fetchUserLeadIdsPaginated(supabase, userId)
  if (leadIds.length === 0) return { data: [], error: null }

  const out: Record<string, unknown>[] = []

  for (let i = 0; i < leadIds.length; i += DASHBOARD_LEAD_CHUNK) {
    const chunk = leadIds.slice(i, i + DASHBOARD_LEAD_CHUNK)
    for (let from = 0; ; from += DASHBOARD_MSG_PAGE) {
      const to = from + DASHBOARD_MSG_PAGE - 1
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .in("lead_id", chunk)
        .not("thread_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, to)

      if (error) {
        return {
          data: out,
          error: { message: error.message },
        }
      }
      const rows = data ?? []
      out.push(...rows)
      if (rows.length < DASHBOARD_MSG_PAGE) break
    }
  }

  return { data: out, error: null }
}

export async function fetchAllLeadsForDashboardUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  data: Record<string, unknown>[]
  error: { message: string } | null
}> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += DASHBOARD_TABLE_PAGE) {
    const to = from + DASHBOARD_TABLE_PAGE - 1
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to)

    if (error) return { data: out, error: { message: error.message } }
    const chunk = data ?? []
    out.push(...chunk)
    if (chunk.length < DASHBOARD_TABLE_PAGE) break
  }
  return { data: out, error: null }
}

export async function fetchAllCampaignsForDashboardUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  data: Record<string, unknown>[]
  error: { message: string } | null
}> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += DASHBOARD_TABLE_PAGE) {
    const to = from + DASHBOARD_TABLE_PAGE - 1
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to)

    if (error) return { data: out, error: { message: error.message } }
    const chunk = data ?? []
    out.push(...chunk)
    if (chunk.length < DASHBOARD_TABLE_PAGE) break
  }
  return { data: out, error: null }
}
