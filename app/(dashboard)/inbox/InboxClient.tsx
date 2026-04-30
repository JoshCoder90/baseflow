"use client"

/**
 * Lead-list inbox — all thread messages from `supabase.from("messages").select("*")` filtered by `thread_id`.
 * No Gmail API in this file; sync inserts inbound rows in the background.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { emailBodyToDisplayHtml } from "@/lib/email-body-display"
import { runGmailInboxSync } from "@/lib/gmail-inbox-sync-client"

type LeadWithMessage = {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  tag?: string | null
  summary?: string | null
  unread?: boolean | null
  read?: boolean | null
  campaign_id?: string | null
  /** Same as `messages.thread_id` in DB — conversation key for loading/saving messages */
  thread_id?: string | null
  last_message: string
  /** Duplicate CRM rows for the same email — load messages for all IDs as one thread */
  mergedLeadIds?: string[]
}

type Message = {
  id: string
  role: "outbound" | "inbound" | string
  content?: string | null
  channel?: string | null
  created_at?: string | null
  thread_id?: string | null
  lead_id?: string | null
}

type Props = {
  leads: LeadWithMessage[]
}

function dedupeThreadMessages(rows: Message[]): Message[] {
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(a.created_at ?? 0).getTime() -
      new Date(b.created_at ?? 0).getTime()
  )
  const seenId = new Set<string>()
  const byGmail = new Map<string, Message>()
  const noGmail: Message[] = []
  for (const m of sorted) {
    if (seenId.has(m.id)) continue
    seenId.add(m.id)
    const gid = (m as { gmail_message_id?: string | null }).gmail_message_id?.trim()
    if (gid) byGmail.set(gid, m)
    else noGmail.push(m)
  }
  return [...noGmail, ...byGmail.values()].sort(
    (a, b) =>
      new Date(a.created_at ?? 0).getTime() -
      new Date(b.created_at ?? 0).getTime()
  )
}

export function InboxClient({ leads: initialLeads }: Props) {
  const router = useRouter()
  const [leads, setLeads] = useState<LeadWithMessage[]>(initialLeads)
  const [activeTab, setActiveTab] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedLead, setSelectedLead] = useState<LeadWithMessage | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [replyText, setReplyText] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const suggestionsRequestId = useRef(0)

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  /** Pull Gmail → Supabase so inbound replies appear (no separate worker required). */
  useEffect(() => {
    let cancelled = false
    const lastSyncAt = { current: 0 }
    const MIN_SYNC_GAP_MS = 35_000

    async function syncPull() {
      const now = Date.now()
      if (now - lastSyncAt.current < MIN_SYNC_GAP_MS) return
      lastSyncAt.current = now
      const r = await runGmailInboxSync()
      if (!cancelled && r.ok && (r.imported ?? 0) > 0) router.refresh()
    }

    void syncPull()
    const interval = setInterval(() => void syncPull(), 90_000)
    const onFocus = () => void syncPull()
    window.addEventListener("focus", onFocus)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  }, [router])

  const leadIdsRef = useRef<Set<string>>(new Set())
  leadIdsRef.current = new Set(
    leads.flatMap((l) => l.mergedLeadIds ?? [l.id])
  )

  /** Maps any duplicate lead UUID → canonical inbox row id (merged-by-email). */
  const canonicalLeadIdRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const m = new Map<string, string>()
    for (const l of leads) {
      const canon = l.id
      for (const id of l.mergedLeadIds ?? [l.id]) {
        m.set(id, canon)
      }
    }
    canonicalLeadIdRef.current = m
  }, [leads])

  useEffect(() => {
    const channel = supabase
      .channel("inbox-leads-unread")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads" },
        (payload) => {
          const updated = payload.new as { id: string; unread?: boolean }
          setLeads((prev) =>
            prev.map((l) =>
              l.id === updated.id ? { ...l, unread: updated.unread ?? l.unread } : l
            )
          )
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // When a message is inserted, update unread and add lead to inbox if not present
  useEffect(() => {
    const channel = supabase
      .channel("inbox-messages-insert-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row = payload.new as { lead_id?: string; role?: string; content?: string | null }
          const leadId = row?.lead_id
          if (!leadId) return
          const role = row?.role
          if (role === "lead" || role === "inbound") {
            await supabase.from("leads").update({ unread: true }).eq("id", leadId)
          }
          const isInList = leadIdsRef.current.has(leadId)
          if (!isInList) {
            router.refresh()
          } else if (role === "lead" || role === "inbound") {
            const canonicalId =
              canonicalLeadIdRef.current.get(leadId) ?? leadId
            await supabase
              .from("leads")
              .update({ unread: true })
              .eq("id", canonicalId)
            setLeads((prev) =>
              prev.map((l) =>
                l.id === canonicalId ? { ...l, unread: true } : l
              )
            )
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])

  useEffect(() => {
    if (!selectedLead) {
      setMessages([])
      setSuggestions([])
      return
    }

    const leadIdsForThread = selectedLead.mergedLeadIds?.length
      ? selectedLead.mergedLeadIds
      : [selectedLead.id]

    async function loadMessages() {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .in("lead_id", leadIdsForThread)
        .order("created_at", { ascending: true })

      if (!error && data) {
        setMessages(dedupeThreadMessages(data as Message[]))
      } else {
        if (error) console.error("[InboxClient] loadMessages:", error)
        setMessages([])
      }
    }

    void loadMessages()

    const realtimeChannels: ReturnType<typeof supabase.channel>[] = []
    for (const lid of leadIdsForThread) {
      const ch = supabase.channel(
        `inbox-msg-${selectedLead.id}-${lid}`.slice(0, 120)
      )
      ch.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${lid}`,
        },
        (payload) => {
          const newMessage = payload.new as Message
          if (!leadIdsForThread.includes(newMessage.lead_id as string)) return
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev
            return dedupeThreadMessages([...prev, newMessage])
          })
        }
      )
      ch.subscribe()
      realtimeChannels.push(ch)
    }

    return () => {
      for (const c of realtimeChannels) {
        void supabase.removeChannel(c)
      }
    }
  }, [selectedLead])

  const generateSuggestions = useCallback(async (lead: LeadWithMessage) => {
    const req = ++suggestionsRequestId.current
    setLoadingSuggestions(true)
    setSuggestions([])
    try {
      const leadIds = lead.mergedLeadIds ?? [lead.id]
      let { data, error } = await supabase
        .from("messages")
        .select("*")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: true })

      if (req !== suggestionsRequestId.current) return

      data = data ? dedupeThreadMessages(data as Message[]) : data

      const tid = lead.thread_id?.trim()
      if ((!data || data.length === 0) && tid) {
        const r2 = await supabase
          .from("messages")
          .select("*")
          .eq("thread_id", tid)
          .order("created_at", { ascending: true })
        if (req !== suggestionsRequestId.current) return
        data = r2.data ? dedupeThreadMessages(r2.data as Message[]) : r2.data
        error = r2.error
      }

      if (req !== suggestionsRequestId.current) return

      if (error || !data?.length) {
        setSuggestions([])
        return
      }

      const mappedMessages = data.map((m) => {
        const r = (m as Message).role
        return {
          role: r === "inbound" || r === "lead" ? "user" : "assistant",
          content: (m as { content?: string | null }).content ?? "",
        }
      })

      const res = await fetch("/api/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: mappedMessages }),
      })
      const replyData = await res.json()
      const reply = replyData.reply ?? ""
      const opts = reply
        .split(/OPTION \d+:\s*/i)
        .map((s: string) => s.trim())
        .filter(Boolean)
      if (req !== suggestionsRequestId.current) return
      setSuggestions(opts.slice(0, 3))
    } catch {
      if (req === suggestionsRequestId.current) setSuggestions([])
    } finally {
      if (req === suggestionsRequestId.current) setLoadingSuggestions(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedLead?.id) return
    void generateSuggestions(selectedLead)
  }, [
    selectedLead?.id,
    selectedLead?.mergedLeadIds?.join(","),
    generateSuggestions,
  ])

  function handleRegenerateSuggestions() {
    if (!selectedLead?.id) return
    void generateSuggestions(selectedLead)
  }

  const searchLower = searchQuery.trim().toLowerCase()
  const leadsMatchingSearch = leads.filter((lead) => {
    if (!searchLower) return true
    const name = (lead.name ?? "").toLowerCase()
    const email = (lead.email ?? "").toLowerCase()
    const company = (lead.company ?? "").toLowerCase()
    return (
      name.includes(searchLower) ||
      email.includes(searchLower) ||
      company.includes(searchLower)
    )
  })

  const filteredLeads = leadsMatchingSearch.filter((lead) => {
    if (activeTab === "all") return true
    if (activeTab === "unread") return Boolean(lead.unread)
    return true
  })

  async function handleSendReply(content: string) {
    if (!selectedLead?.id) {
      window.alert("Lead no longer exists")
      return
    }
    const threadId =
      [...messages].reverse().find((m) => m.thread_id?.trim())?.thread_id?.trim() ??
      selectedLead.thread_id?.trim()
    if (!threadId) {
      console.warn(
        "[InboxClient] Cannot send: no thread_id on messages yet (wait for sync or send from campaign)."
      )
      return
    }
    const text = content.trim()
    if (!text) return

    const { data: leadExists, error: leadCheckErr } = await supabase
      .from("leads")
      .select("id")
      .eq("id", selectedLead.id)
      .single()

    if (leadCheckErr || !leadExists) {
      window.alert("This lead was deleted. Refresh inbox.")
      return
    }

    const safeMessage = {
      content: text,
      role: "outbound" as const,
      lead_id: selectedLead.id,
      thread_id: threadId,
      campaign_id: selectedLead.campaign_id ?? null,
    }

    const { data, error } = await supabase
      .from("messages")
      .insert(safeMessage)
      .select("*")
      .single()

    if (error) {
      console.error("INSERT FAILED:", error)
      return
    }

    setReplyText("")
    setMessages((prev) => [...prev, data as Message])
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 w-full max-w-full overflow-hidden bg-neutral-950 text-white">
      <div className="flex w-[320px] flex-shrink-0 flex-col border-r border-zinc-800 min-h-0">
        <div className="shrink-0 border-b border-zinc-800">
          <div className="p-4 pb-2 text-lg font-semibold">Inbox</div>
          <div className="px-4 pb-3">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
          </div>
          <div className="px-3 mb-3">
            <div className="flex gap-2">
              {[
                { key: "all", label: "All" },
                { key: "unread", label: "Unread" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1 rounded-full text-sm transition ${
                    activeTab === tab.key
                      ? "bg-white text-black"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 opacity-70">
                    (
                    {tab.key === "all"
                      ? leads.length
                      : leads.filter((l) => l.unread).length}
                    )
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredLeads.map((lead) => (
          <div
            key={lead.id}
            onClick={async () => {
              setSelectedLead(lead)
              if (lead.unread) {
                await supabase.from("leads").update({ unread: false }).eq("id", lead.id)
                setLeads((prev) =>
                  prev.map((l) => (l.id === lead.id ? { ...l, unread: false } : l))
                )
              }
            }}
            className={`p-4 border-b border-neutral-800 hover:bg-neutral-900 cursor-pointer ${selectedLead?.id === lead.id ? "bg-neutral-900" : ""}`}
          >
            <div className="flex items-center gap-3">
              {lead.unread && (
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-sm shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span
                    className={`truncate flex-1 mr-2 ${
                      lead.unread ? "font-medium text-white" : "text-neutral-400"
                    }`}
                  >
                    {lead.name ?? "Unnamed Lead"}
                  </span>
                </div>

                <div className="text-sm text-gray-400 mt-1 truncate">
                  {lead.last_message}
                </div>
              </div>
            </div>
          </div>
        ))}

        {filteredLeads.length === 0 && (
          <div className="p-4 text-sm text-gray-500">
            {leads.length === 0
              ? "No conversations yet. Start a campaign to begin messaging leads."
              : leadsMatchingSearch.length === 0
                ? "No matches for your search."
                : "No leads match this filter."}
          </div>
        )}
        </div>
      </div>

      <div className="flex-1 min-w-0 min-h-0 flex px-4 py-4 overflow-hidden gap-4">
        {selectedLead ? (
          <>
            {/* Conversation panel: flex col, messages scroll, reply fixed at bottom */}
            <div className="flex flex-col h-full min-h-0 flex-1 min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
                <div className="text-xs tracking-wide text-zinc-500 uppercase">Conversation</div>
              </div>
              <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto scroll-smooth px-4 py-4">
                {messages.length === 0 ? (
                  <>
                    <p className="text-sm text-zinc-500">No conversation yet</p>
                    <div ref={messagesEndRef} />
                  </>
                ) : (
                  <>
                    {messages.map((msg) => {
                      const isUser =
                        msg.role === "outbound" ||
                        (msg as { sender?: string }).sender === "user"
                      return (
                        <div key={msg.id} className="flex w-full flex-col gap-1">
                          <div
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
                          <div
                            className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
                          >
                            <span className="px-1 text-[10px] uppercase tracking-wider text-zinc-500">
                              {isUser ? "You · email" : "Lead · email"}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
              <div className="border-t border-zinc-800 p-4 bg-zinc-900 shrink-0">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  rows={2}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm text-white placeholder:text-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 resize-none"
                />
                <button
                  type="button"
                  onClick={() => handleSendReply(replyText)}
                  className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
                >
                  Send Reply
                </button>
              </div>
            </div>

            {/* AI Reply Suggestions - right next to messages */}
            <div className="w-[300px] border border-zinc-800 flex-shrink-0 flex flex-col overflow-hidden rounded-xl bg-zinc-900">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-800 p-4">
                <div className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                  AI Reply Suggestions
                </div>
                <button
                  type="button"
                  disabled={loadingSuggestions}
                  onClick={handleRegenerateSuggestions}
                  className="shrink-0 text-xs text-blue-400 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Regenerate
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 conversation-scroll">
                {loadingSuggestions ? (
                  <p className="text-base text-zinc-500">Generating...</p>
                ) : suggestions.length === 0 ? (
                  <p className="text-base text-zinc-500">No suggestions yet</p>
                ) : (
                  suggestions.map((reply, i) => (
                    <button
                      key={i}
                      onClick={() => setReplyText(reply)}
                      className="bg-neutral-800/80 hover:bg-neutral-800 px-4 py-3 rounded-lg text-base text-left break-words transition"
                    >
                      {reply}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Lead at a glance + Next steps - compact, no empty space */}
            <div className="w-[280px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shrink-0">
                <div className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
                  Lead at a glance
                </div>
                <div className="space-y-4">
                  {selectedLead.phone && (
                    <div>
                      <span className="text-sm text-zinc-500 block mb-0.5">Phone</span>
                      <a
                        href={`tel:${String(selectedLead.phone).replace(/\s/g, "")}`}
                        className="text-base text-zinc-200 hover:text-white transition"
                      >
                        {selectedLead.phone}
                      </a>
                    </div>
                  )}
                  {selectedLead.company && (
                    <div>
                      <span className="text-sm text-zinc-500 block mb-0.5">Company</span>
                      <span className="text-base text-zinc-200">{selectedLead.company}</span>
                    </div>
                  )}
                  {selectedLead.email && (
                    <a
                      href={`mailto:${selectedLead.email}`}
                      className="text-base text-blue-400 hover:text-blue-300 transition block truncate"
                    >
                      {selectedLead.email}
                    </a>
                  )}
                </div>
                <a
                  href={`/leads/${selectedLead.id}`}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-base font-medium text-zinc-200 hover:bg-zinc-800 transition"
                >
                  View full profile →
                </a>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shrink-0">
                <div className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                  Next steps
                </div>
                <ul className="space-y-2 text-base text-zinc-400">
                  <li>• Reply to keep momentum</li>
                  <li>• Share pricing if they ask</li>
                  <li>• Book a call when ready</li>
                </ul>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-white p-6 overflow-y-auto">
            <div className="max-w-xl w-full space-y-6">
              <div className="text-2xl font-semibold">
                Inbox Overview
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                <div className="text-sm text-gray-400 mb-2">
                  Today&apos;s Activity
                </div>
                <div className="space-y-1 text-sm">
                  <div>• {leads.length} conversations</div>
                  <div>• 0 replies needed</div>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                <div className="text-sm text-gray-400 mb-2">
                  Recent Conversation
                </div>
                <div className="text-sm">
                  {leads[0] ? (
                    <>{leads[0].name ?? "Unnamed Lead"} — {leads[0].last_message}</>
                  ) : (
                    <>No recent conversations</>
                  )}
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                <div className="text-sm text-gray-400 mb-2">
                  AI Suggestions
                </div>
                <div className="space-y-1 text-sm">
                  <div>• Follow up on open threads</div>
                  <div>• Send pricing breakdown</div>
                  <div>• Ask a qualifying question</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
