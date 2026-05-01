"use client"

/**
 * Gmail / thread inbox UI — 100% database-driven.
 * - Conversation list and message bodies: `supabase.from("messages").select("*")` only (grouped by `thread_id`).
 * - Supporting data: `leads`, `campaigns`, `conversations` from Supabase for labels, niche, read state.
 * - On load, calls GET `/api/sync-gmail-replies` (throttled) so inbound appears without a worker.
 * - Sending uses `/api/send-reply`.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { emailBodyToDisplayHtml, emailBodyToPlainPreview } from "@/lib/email-body-display"
import {
  GMAIL_RECONNECT_REQUIRED,
  useGmailReconnectOptional,
} from "@/app/providers/GmailReconnectProvider"
import {
  fetchAllCampaignsForDashboardUser,
  fetchAllLeadsForDashboardUser,
  fetchAllMessagesForDashboardInbox,
} from "@/app/(dashboard)/inbox/inbox-data"
import { runGmailInboxSync } from "@/lib/gmail-inbox-sync-client"

type AudienceNicheEmbed = {
  niche?: string | null
  name?: string | null
}

type CampaignNicheEmbed = {
  target_search_query?: string | null
  target_audience?: string | null
  audiences?: AudienceNicheEmbed | AudienceNicheEmbed[] | null
}

type LeadEmbed = {
  id?: string
  name?: string | null
  company?: string | null
  email?: string | null
  phone?: string | null
  tag?: string | null
  summary?: string | null
  niche?: string | null
  industry?: string | null
  campaign_id?: string | null
  audiences?: AudienceNicheEmbed | AudienceNicheEmbed[] | null
  campaigns?: CampaignNicheEmbed | CampaignNicheEmbed[] | null
}

/** Campaign row from inbox fetch (niche + common targeting copy). */
type InboxCampaignRow = {
  id: string
  niche?: string | null
  target_search_query?: string | null
  target_audience?: string | null
}

type Message = {
  id: string
  content: string
  role: string
  created_at: string
  thread_id: string
  read?: boolean | null
  lead_id?: string | null
  campaign_id?: string | null
  lead?: LeadEmbed | LeadEmbed[] | null
  /** Some PostgREST configs nest under `leads` instead of alias `lead`. */
  leads?: LeadEmbed | LeadEmbed[] | null
}

function resolveLeadEmbed(msg: Message): LeadEmbed | null {
  const L = msg.lead ?? msg.leads
  if (!L) return null
  return Array.isArray(L) ? L[0] ?? null : L
}

/** Sidebar / header title from lead only — never thread_id or conversation id. */
function leadSidebarTitle(lead: LeadEmbed | null): string {
  return (
    lead?.company?.trim() ||
    lead?.name?.trim() ||
    lead?.email?.trim() ||
    "No Name"
  )
}

type ThreadConversationBucket = {
  thread_id: string
  messages: Message[]
  lead_id: string | null
}

function isInboundMessageRole(role: string | null | undefined): boolean {
  const r = (role ?? "").toLowerCase()
  return r === "inbound" || r === "lead"
}

/** One row per `messages.thread_id` — built only from DB message rows, not from Gmail API. */
type InboxThread = {
  threadId: string
  /** conversations.id when a row exists — used for reliable last_read_at updates */
  conversationId: string | null
  lastMessage: Message
  title: string
  lead: LeadEmbed | null
  /** Resolved from messages[].campaign_id → campaigns (niche / targeting). */
  campaign: InboxCampaignRow | null
  lastMessageAt: string
  lastMessageRole: string
  lastReadAt: string | null
  isUnread: boolean
}

function parseReplyOptions(raw: string): string[] {
  return raw
    .split(/OPTION \d+:\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** `/api/generate-reply` only accepts OpenAI-style roles — map CRM `messages.role`. */
function crmRoleToChatRole(role: string | null | undefined): "user" | "assistant" {
  const r = (role ?? "").toLowerCase()
  return r === "inbound" || r === "lead" ? "user" : "assistant"
}

const AI_REPLY_FALLBACKS = [
  "Sounds great — when would be a good time to chat?",
  "Happy to help — want to hop on a quick call this week?",
  "Would love to learn more about what you're looking for. When works best?",
] as const

/** Always exactly 3 strings for the inbox UI. */
function padAiRepliesToThree(replies: string[]): string[] {
  const paddedReplies = [
    replies[0] || AI_REPLY_FALLBACKS[0],
    replies[1] || AI_REPLY_FALLBACKS[1],
    replies[2] || AI_REPLY_FALLBACKS[2],
  ]
  return paddedReplies.slice(0, 3)
}

async function requestPaddedAiReplies(threadMessages: Message[]): Promise<string[]> {
  const res = await fetch("/api/generate-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: threadMessages.map((m) => ({
        role: crmRoleToChatRole(m.role),
        content: emailBodyToPlainPreview(m.content ?? "") || "",
      })),
    }),
  })
  const data = (await res.json()) as { reply?: string; replies?: string[]; error?: string }
  if (!res.ok) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[dashboard_inbox] generate-reply failed:", data.error ?? res.status)
    }
    return padAiRepliesToThree([])
  }
  const replies = Array.isArray(data.replies)
    ? data.replies.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : parseReplyOptions(data.reply ?? "")
  return padAiRepliesToThree(replies)
}

export default function InboxPage() {
  const gmailReconnect = useGmailReconnectOptional()
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [aiReplies, setAiReplies] = useState<string[]>([])
  const [loadingAI, setLoadingAI] = useState(false)
  const [showAI, setShowAI] = useState(true)
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all")
  const aiRequestSeq = useRef(0)
  const lastGmailSyncMsRef = useRef(0)

  const generateReplies = useCallback(async (threadMessages: Message[]) => {
    if (threadMessages.length === 0) return
    const seq = ++aiRequestSeq.current
    setLoadingAI(true)
    setAiReplies([])
    try {
      const padded = await requestPaddedAiReplies(threadMessages)
      if (seq !== aiRequestSeq.current) return
      setAiReplies(padded)
    } catch (err) {
      console.error(err)
      if (seq !== aiRequestSeq.current) return
      setAiReplies(padAiRepliesToThree([]))
    } finally {
      if (seq === aiRequestSeq.current) setLoadingAI(false)
    }
  }, [])

  /** Sidebar + ordering: group paginated `messages` by `thread_id`; enrich with lead/campaign from DB only. */
  const loadThreads = useCallback(async () => {
    const {
      data: { user: inboxUser },
    } = await supabase.auth.getUser()
    console.log("[dashboard_inbox] loadThreads", {
      page: "dashboard_inbox",
      requestedId: null,
      authenticatedUserId: inboxUser?.id ?? null,
    })

    if (!inboxUser?.id) {
      setThreads([])
      return
    }

    const uid = inboxUser.id

    const nowMs = Date.now()
    if (nowMs - lastGmailSyncMsRef.current >= 35_000) {
      lastGmailSyncMsRef.current = nowMs
      await runGmailInboxSync()
    }

    const [msgRes, leadsRes, campaignsRes] = await Promise.all([
      fetchAllMessagesForDashboardInbox(supabase, uid),
      fetchAllLeadsForDashboardUser(supabase, uid),
      fetchAllCampaignsForDashboardUser(supabase, uid),
    ])

    if (msgRes.error) {
      console.error("[dashboard_inbox] primary messages query error:", msgRes.error)
      setThreads([])
      return
    }

    if (leadsRes.error) {
      console.error("[dashboard_inbox] secondary leads query error:", leadsRes.error)
    }

    if (campaignsRes.error) {
      console.error("[dashboard_inbox] secondary campaigns query error:", campaignsRes.error)
    }

    const rows = msgRes.data as unknown as Message[]
    const leads = leadsRes.data as unknown as LeadEmbed[]
    const campaigns = campaignsRes.data as unknown as InboxCampaignRow[]

    if (!rows.length) {
      setThreads([])
      return
    }

    const grouped: Record<string, ThreadConversationBucket> = {}

    rows.forEach((m) => {
      const tid = m.thread_id
      if (!tid) return
      if (!grouped[tid]) {
        grouped[tid] = {
          thread_id: tid,
          messages: [],
          lead_id:
            typeof m.lead_id === "string" && m.lead_id.length > 0 ? m.lead_id : null,
        }
      }
      grouped[tid].messages.push(m)
      if (!grouped[tid].lead_id && m.lead_id) {
        grouped[tid].lead_id = m.lead_id as string
      }
    })

    const conversations = Object.values(grouped)
    const conversationsWithLeads = conversations.map((c) => ({
      ...c,
      lead: c.lead_id ? leads.find((l) => l.id === c.lead_id) ?? null : null,
    }))

    const conversationsWithData = conversationsWithLeads.map((c) => {
      const campaignId =
        c.messages[0]?.campaign_id ??
        c.messages.find((m) => m.campaign_id)?.campaign_id ??
        c.lead?.campaign_id ??
        null
      const campaign =
        campaignId != null
          ? campaigns.find((camp) => camp.id === campaignId) ?? null
          : null
      return { ...c, campaign }
    })

    const threadIds = conversationsWithData.map((c) => c.thread_id)
    const convByThread = new Map<
      string,
      {
        id: string | null
        lastReadAt: string | null
        lastMessageAt: string | null
        lastMessageRole: string | null
      }
    >()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const convOrderIndex = new Map<string, number>()
    if (user && threadIds.length > 0) {
      const { data: readRows } = await supabase
        .from("conversations")
        .select("id, thread_id, last_read_at, last_message_at, last_message_role")
        .eq("user_id", user.id)
        .in("thread_id", threadIds)
        .order("last_message_at", { ascending: false, nullsFirst: false })
      readRows?.forEach((row, index) => {
        const tid = row.thread_id as string
        if (!tid) return
        if (!convOrderIndex.has(tid)) convOrderIndex.set(tid, index)
        convByThread.set(tid, {
          id: (row.id as string) ?? null,
          lastReadAt: (row.last_read_at as string | null) ?? null,
          lastMessageAt: (row.last_message_at as string | null) ?? null,
          lastMessageRole: (row.last_message_role as string | null) ?? null,
        })
      })
    }

    const formattedRaw: InboxThread[] = conversationsWithData.map((conversation) => {
      const threadId = conversation.thread_id
      const msgs = conversation.messages
      const lead = conversation.lead
      const campaign = conversation.campaign
      const title = leadSidebarTitle(lead)
      const lastMessage = msgs.reduce((best, m) =>
        new Date(m.created_at).getTime() > new Date(best.created_at).getTime() ? m : best
      )
      const conv = convByThread.get(threadId)
      const msgT = new Date(lastMessage.created_at).getTime()
      const convT = conv?.lastMessageAt
        ? new Date(conv.lastMessageAt).getTime()
        : 0
      const sortT = Math.max(msgT, convT)
      const lastMessageAt = new Date(sortT).toISOString()
      const lastReadAt = conv?.lastReadAt ?? null
      const lastMessageRole = (
        lastMessage.role ||
        conv?.lastMessageRole ||
        ""
      ).trim()
      const isUnread = msgs.some(
        (m) => isInboundMessageRole(m.role) && m.read !== true
      )
      return {
        threadId,
        conversationId: conv?.id ?? null,
        lastMessage,
        lead,
        campaign,
        title,
        lastMessageAt,
        lastMessageRole,
        lastReadAt,
        isUnread,
      }
    })

    const formatted = formattedRaw.filter((t) => t.lead != null)

    formatted.sort((a, b) => {
      const tb = new Date(b.lastMessageAt).getTime()
      const ta = new Date(a.lastMessageAt).getTime()
      if (tb !== ta) return tb - ta
      const ia = convOrderIndex.get(a.threadId) ?? 1e9
      const ib = convOrderIndex.get(b.threadId) ?? 1e9
      return ia - ib
    })

    if (process.env.NODE_ENV === "development") {
      for (const t of formatted) {
        if (leadSidebarTitle(t.lead) === "No Name") {
          console.warn("[inbox] sidebar: no company/name/email; check lead embed", {
            threadId: t.threadId,
            lead: t.lead,
          })
        }
      }
    }

    setThreads(formatted)
  }, [])

  /**
   * When there is no conversations.id yet: update by thread_id or insert (RLS: user_id).
   */
  async function persistReadByThreadId(
    threadId: string,
    readAt: string
  ): Promise<string | undefined> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      console.warn("[inbox] mark read: no session")
      return undefined
    }

    const { data: updatedRows, error: upErr } = await supabase
      .from("conversations")
      .update({ last_read_at: readAt, updated_at: readAt })
      .eq("user_id", user.id)
      .eq("thread_id", threadId)
      .select("id")

    if (upErr) {
      console.error("Failed to update last_read_at", upErr)
      return undefined
    }

    if (updatedRows && updatedRows.length > 0) {
      console.log("UPDATED READ TIME:", readAt)
      return updatedRows[0].id as string
    }

    const { data: inserted, error: insErr } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        thread_id: threadId,
        last_read_at: readAt,
        updated_at: readAt,
      })
      .select("id")
    if (insErr) {
      console.error("Failed to update last_read_at (insert)", insErr)
      return undefined
    }
    if (inserted && inserted.length > 0) {
      console.log("UPDATED READ TIME:", readAt)
      return inserted[0].id as string
    }
    return undefined
  }

  const MESSAGE_READ_BATCH = 150

  /** Mark every message in the thread read by primary key (avoids filter mismatch). */
  async function markThreadMessagesRead(selectedThreadId: string) {
    const { data: msgs, error: selErr } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", selectedThreadId)

    if (selErr) {
      console.error("[inbox] mark messages read (select):", selErr)
      return
    }

    const ids = (msgs ?? []).map((m) => m.id as string).filter(Boolean)
    if (ids.length === 0) return

    for (let i = 0; i < ids.length; i += MESSAGE_READ_BATCH) {
      const batch = ids.slice(i, i + MESSAGE_READ_BATCH)
      const { error: upErr } = await supabase
        .from("messages")
        .update({ read: true })
        .in("id", batch)
      if (upErr) {
        console.error("[inbox] mark messages read (update):", upErr)
        return
      }
    }
  }

  async function handleSelectThread(threadId: string, conversationId?: string | null) {
    const now = new Date().toISOString()
    let resolvedId: string | undefined

    if (conversationId) {
      const { data, error } = await supabase
        .from("conversations")
        .update({ last_read_at: now })
        .eq("id", conversationId)
        .select("id")

      if (error) {
        console.error("Failed to update last_read_at", error)
        resolvedId = await persistReadByThreadId(threadId, now)
      } else if (data && data.length > 0) {
        console.log("UPDATED READ TIME:", now)
        resolvedId = conversationId
      } else {
        console.warn(
          "[inbox] no row for conversation id; falling back to thread_id",
          conversationId
        )
        resolvedId = await persistReadByThreadId(threadId, now)
      }
    } else {
      resolvedId = await persistReadByThreadId(threadId, now)
    }

    await markThreadMessagesRead(threadId)

    setSelectedThread(threadId)
    setThreads((prev) =>
      prev.map((c) =>
        c.threadId === threadId ||
        (conversationId != null && c.conversationId === conversationId)
          ? {
              ...c,
              lastReadAt: now,
              isUnread: false,
              conversationId: resolvedId ?? c.conversationId,
            }
          : c
      )
    )
  }

  async function recordOutboundConversation(threadId: string, lastActivityAt: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const now = new Date().toISOString()
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .eq("thread_id", threadId)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabase
        .from("conversations")
        .update({
          last_read_at: now,
          last_message_at: lastActivityAt,
          last_message_role: "outbound",
          updated_at: now,
        })
        .eq("id", existing.id as string)
      if (error) console.warn("[inbox] outbound conversation:", error.message)
    } else {
      const { error } = await supabase.from("conversations").insert({
        user_id: user.id,
        thread_id: threadId,
        last_read_at: now,
        last_message_at: lastActivityAt,
        last_message_role: "outbound",
        updated_at: now,
      })
      if (error) console.warn("[inbox] outbound conversation:", error.message)
    }
  }

  /** Active thread transcript — `messages` table only (no Gmail fetch). Returns rows shown in the pane. */
  async function loadMessages(threadId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Messages load error:", error)
      setMessages([])
      return []
    }

    const list = (data as Message[]) || []
    const missingLeadIds = [
      ...new Set(
        list
          .filter((m) => m.lead_id && !resolveLeadEmbed(m))
          .map((m) => m.lead_id as string)
      ),
    ]

    if (missingLeadIds.length > 0) {
      const { data: leadRows } = await supabase
        .from("leads")
        .select("id, name, company, email")
        .in("id", missingLeadIds)
      const leadById = new Map<string, LeadEmbed>()
      for (const row of leadRows ?? []) {
        leadById.set(row.id as string, row as LeadEmbed)
      }
      const enriched = list.map((m) => {
        if (resolveLeadEmbed(m) || !m.lead_id) return m
        const L = leadById.get(m.lead_id)
        return L ? { ...m, lead: L } : m
      })
      setMessages(enriched)
      return enriched
    }

    setMessages(list)
    return list
  }

  async function sendReply() {
    const text = reply.trim()
    if (!text || !selectedThread) return

    let leadId =
      messages.find((m) => m.lead_id)?.lead_id ??
      threads.find((t) => t.threadId === selectedThread)?.lastMessage?.lead_id ??
      null

    if (!leadId) {
      const { data: row } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", selectedThread)
        .not("lead_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      leadId = (row?.lead_id as string | undefined) ?? null
    }

    if (!leadId) {
      console.error("[inbox] Cannot send: no lead_id for thread", selectedThread)
      window.alert(
        "This thread has no linked contact in the database yet. Add a lead or wait until an outbound message is saved with a lead and thread id."
      )
      return
    }

    const threadRow = threads.find((t) => t.threadId === selectedThread)
    const msgForLead = messages.find((m) => m.lead_id === leadId)
    const toEmail =
      threadRow?.lead?.email?.trim() ||
      (msgForLead ? resolveLeadEmbed(msgForLead)?.email?.trim() : "") ||
      ""

    if (!toEmail) {
      window.alert("This contact has no email address. Add an email on the lead to send.")
      return
    }

    setSending(true)
    try {
      const sendRes = await fetch("/api/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toEmail,
          subject: "Re:",
          message: text,
          threadId: selectedThread,
        }),
      })
      const sendPayload = (await sendRes.json().catch(() => ({}))) as {
        error?: string
        success?: boolean
      }

      if (!sendRes.ok) {
        const errMsg = sendPayload.error ?? "Failed to send email"
        gmailReconnect?.handlePossibleGmailReconnect(sendPayload)
        if (
          errMsg === GMAIL_RECONNECT_REQUIRED ||
          errMsg.includes(GMAIL_RECONNECT_REQUIRED)
        ) {
          window.alert("Gmail needs to be reconnected. Open Connections and reconnect your account.")
        } else {
          window.alert(errMsg)
        }
        return
      }

      const safeMessage = {
        content: text,
        role: "outbound" as const,
        lead_id: threadRow?.lead?.id ?? leadId ?? null,
        thread_id: selectedThread ?? null,
        campaign_id: messages[0]?.campaign_id ?? null,
      }

      console.log("SENDING MESSAGE:", safeMessage)

      const { data, error } = await supabase
        .from("messages")
        .insert(safeMessage)
        .select("*")
        .single()

      if (error) {
        console.error("INSERT FAILED:", error)
        window.alert(error.message)
        return
      }

      setReply("")

      const newMsg = data as Message
      const nextMessages = messages.some((m) => m.id === newMsg.id)
        ? messages
        : [...messages, newMsg]
      setMessages(nextMessages)
      void generateReplies(nextMessages)

      const lastActivityAt = newMsg?.created_at ?? new Date().toISOString()
      await recordOutboundConversation(selectedThread, lastActivityAt)
      const nowIso = new Date().toISOString()
      setThreads((prev) => {
        const mapped = prev.map((t) =>
          t.threadId === selectedThread
            ? {
                ...t,
                lastMessage: newMsg ?? t.lastMessage,
                lastMessageAt: lastActivityAt,
                lastMessageRole: "outbound",
                lastReadAt: nowIso,
                isUnread: false,
              }
            : t
        )
        return mapped.sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
        )
      })
      await loadThreads()
    } catch (err) {
      console.error(err)
      window.alert("Something went wrong while sending. Please try again.")
    } finally {
      setSending(false)
    }
  }

  const loadThreadsRef = useRef(loadThreads)
  loadThreadsRef.current = loadThreads

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel("inbox-messages-insert")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          clearTimeout(debounce)
          debounce = setTimeout(() => {
            void loadThreadsRef.current()
          }, 350)
        }
      )
      .subscribe()

    return () => {
      clearTimeout(debounce)
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!selectedThread) {
      setMessages([])
      setAiReplies([])
      return
    }
    let cancelled = false
    void (async () => {
      const list = await loadMessages(selectedThread)
      if (cancelled) return
      if (list.length > 0) {
        await generateReplies(list)
      } else {
        setAiReplies([])
        setLoadingAI(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedThread, generateReplies])

  /** Gmail sync / other tabs insert rows — refresh transcript + suggestions for the open thread. */
  useEffect(() => {
    if (!selectedThread) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    const ch = supabase
      .channel(`dashboard-inbox-thread-${selectedThread}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${selectedThread}`,
        },
        () => {
          clearTimeout(debounce)
          debounce = setTimeout(() => {
            void (async () => {
              const list = await loadMessages(selectedThread)
              if (list.length > 0) await generateReplies(list)
              else {
                setAiReplies([])
                setLoadingAI(false)
              }
            })()
          }, 400)
        }
      )
      .subscribe()

    return () => {
      clearTimeout(debounce)
      void supabase.removeChannel(ch)
    }
  }, [selectedThread, generateReplies])

  function handleRegenerateAiReplies() {
    if (!selectedThread) return
    void (async () => {
      const list = await loadMessages(selectedThread)
      if (list.length > 0) await generateReplies(list)
    })()
  }

  const activeThread =
    selectedThread != null
      ? (threads.find((t) => t.threadId === selectedThread) ?? null)
      : null
  const panelLead = activeThread?.lead ?? null
  const panelTitle = leadSidebarTitle(panelLead)
  const panelEmail = panelLead?.email?.trim() ?? ""
  const panelPhone = panelLead?.phone?.trim() ?? ""

  const q = search.trim().toLowerCase()

  const searchFiltered = threads.filter((t) => {
    if (!q) return true
    const l = t.lead
    const company = (l?.company ?? "").toLowerCase()
    const name = (l?.name ?? "").toLowerCase()
    const email = (l?.email ?? "").toLowerCase()
    return company.includes(q) || name.includes(q) || email.includes(q)
  })

  const filteredThreads = searchFiltered.filter((t) => {
    if (activeTab === "all") return true
    if (activeTab === "unread") return t.isUnread
    return true
  })

  const unreadCount = threads.filter((t) => t.isUnread).length

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden text-white">
      {/* LEFT SIDEBAR — thread list scrolls independently; column does not grow past viewport */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-white/10 min-h-0">
        <div className="shrink-0 border-b border-white/10">
          <h2 className="px-3 pt-3 pb-2 text-lg font-semibold text-white">Inbox</h2>
          <div className="px-3 pb-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-blue-500"
            />
          </div>
          <div className="px-3 pb-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`px-3 py-1 rounded-full text-sm transition ${
                  activeTab === "all"
                    ? "bg-white text-black"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                All ({threads.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("unread")}
                className={`px-3 py-1 rounded-full text-sm transition ${
                  activeTab === "unread"
                    ? "bg-white text-black"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-4">
          {threads.length === 0 && (
            <p className="px-2 text-sm text-gray-500">No conversations yet</p>
          )}

          {threads.length > 0 && searchFiltered.length === 0 && (
            <p className="px-2 text-sm text-gray-500">No matches</p>
          )}

          {threads.length > 0 &&
            searchFiltered.length > 0 &&
            filteredThreads.length === 0 && (
              <p className="px-2 text-sm text-gray-500">No leads match this filter.</p>
            )}

          {filteredThreads.map((thread) => (
            <button
              type="button"
              key={thread.threadId}
              onClick={() => void handleSelectThread(thread.threadId, thread.conversationId)}
              className={`flex w-full items-start gap-2 rounded p-3 text-left cursor-pointer ${
                selectedThread === thread.threadId
                  ? "bg-blue-600"
                  : "bg-[#111] hover:bg-[#1a1a1a]"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-white">
                  {leadSidebarTitle(thread.lead)}
                </div>
                <div className="mt-0.5 truncate text-xs text-white/50">
                  {emailBodyToPlainPreview(thread.lastMessage?.content ?? "")}
                </div>
              </div>
              {thread.isUnread && (
                <div
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500 ml-2"
                  aria-label="Unread"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT CHAT — no overflow here; only messages pane scrolls */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!selectedThread && (
          <div className="flex flex-1 items-center justify-center text-gray-500">
            Select a conversation
          </div>
        )}

        {selectedThread && (
          <>
            {/* HEADER (fixed) */}
            <div className="shrink-0 border-b border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-lg font-semibold text-white">{panelTitle}</span>
                  <span className="truncate text-sm text-white/60">
                    {panelEmail || "No email on file"}
                  </span>
                  <span className="truncate text-sm text-white/60">
                    {panelPhone ? panelPhone : "No phone"}
                  </span>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                  {panelEmail ? (
                    <a
                      href={`mailto:${panelEmail}`}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition hover:bg-white/20"
                    >
                      Email
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="cursor-not-allowed rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white/35"
                    >
                      Email
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* MESSAGES — sole vertical scroll in chat column */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                const isUser =
                  msg.role === "outbound" ||
                  (msg as { sender?: string }).sender === "user"
                return (
                  <div
                    key={msg.id}
                    className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={[
                        "max-w-[60%] break-words rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap shadow-sm transition-all duration-150 [&_a]:underline",
                        isUser
                          ? "bg-blue-500 text-white hover:bg-blue-500/95 [&_a]:text-white"
                          : "bg-white/10 text-white hover:bg-white/[0.12] [&_a]:text-blue-200",
                      ].join(" ")}
                      dangerouslySetInnerHTML={{
                        __html: emailBodyToDisplayHtml(msg.content) || "—",
                      }}
                    />
                  </div>
                )
              })}
            </div>

            {/* AI reply suggestions — click fills composer; does not send */}
            <div className="shrink-0 border-t border-white/10">
              <div className="px-4 pb-2 pt-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs text-white/50">AI Suggestions</div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={loadingAI}
                        onClick={handleRegenerateAiReplies}
                        className="text-xs text-blue-400 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loadingAI ? "..." : "Regenerate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAI(!showAI)}
                        className="text-xs text-white/40 hover:text-white"
                      >
                        {showAI ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {showAI && (
                    <>
                      {loadingAI && (
                        <div className="text-sm text-white/40">Thinking...</div>
                      )}

                      {!loadingAI &&
                        aiReplies.map((replyText, i) => (
                          <div
                            key={`${i}-${replyText.slice(0, 24)}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setReply(replyText)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                setReply(replyText)
                              }
                            }}
                            className="mb-1 cursor-pointer rounded-lg p-2 text-sm text-white last:mb-0 hover:bg-white/10"
                          >
                            {replyText}
                          </div>
                        ))}
                    </>
                  )}
                </div>
              </div>
              <div className="px-4 pb-4">
              <div className="flex gap-2">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !sending) {
                      e.preventDefault()
                      void sendReply()
                    }
                  }}
                  placeholder="Write a reply..."
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-blue-500/40"
                />
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void sendReply()}
                  className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
