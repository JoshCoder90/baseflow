"use client"

import { useState, useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"

type LeadWithMessage = {
  id: string
  name?: string | null
  email?: string | null
  company?: string | null
  status?: string | null
  tag?: string | null
  summary?: string | null
  unread?: boolean
  last_message: string
  temperature: string
  score: number | null
}

type Message = {
  id: string
  role: "outbound" | "inbound"
  content?: string | null
  created_at?: string | null
}

type Props = {
  leads: LeadWithMessage[]
}

export function InboxClient({ leads: initialLeads }: Props) {
  const [leads, setLeads] = useState<LeadWithMessage[]>(initialLeads)
  const [selectedLead, setSelectedLead] = useState<LeadWithMessage | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [replyText, setReplyText] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [messages])

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

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

  // When a lead message is inserted (from any source), mark that lead as unread
  useEffect(() => {
    const channel = supabase
      .channel("inbox-messages-insert-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const row = payload.new as { lead_id?: string; role?: string }
          const role = row?.role
          const leadId = row?.lead_id
          if (!leadId || (role !== "lead" && role !== "inbound")) return
          await supabase.from("leads").update({ unread: true }).eq("id", leadId)
          setLeads((prev) =>
            prev.map((l) => (l.id === leadId ? { ...l, unread: true } : l))
          )
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!selectedLead) {
      setMessages([])
      setSuggestions([])
      return
    }

    async function loadMessages() {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("lead_id", selectedLead!.id)
        .order("created_at", { ascending: true })

      if (!error && data) {
        setMessages(data as Message[])
      } else {
        setMessages([])
      }
    }

    loadMessages()

    const channel = supabase
      .channel(`inbox-messages-${selectedLead.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${selectedLead.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message
          setMessages((prev) => [...prev, newMessage])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedLead])

  useEffect(() => {
    if (!selectedLead || messages.length === 0) {
      setSuggestions([])
      return
    }

    async function fetchSuggestions() {
      setLoadingSuggestions(true)
      try {
        const mappedMessages = messages.map((m) => ({
          role: m.role === "inbound" ? "user" : "assistant",
          content: m.content ?? "",
        }))
        const res = await fetch("/api/generate-reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: mappedMessages }),
        })
        const data = await res.json()
        const reply = data.reply ?? ""
        const opts = reply
          .split(/OPTION \d+:\s*/i)
          .map((s) => s.trim())
          .filter(Boolean)
        setSuggestions(opts.slice(0, 3))
      } catch {
        setSuggestions([])
      } finally {
        setLoadingSuggestions(false)
      }
    }

    fetchSuggestions()
  }, [selectedLead, messages])

  async function handleSendReply(content: string) {
    if (!selectedLead) return
    const text = content.trim()
    if (!text) return

    const { error } = await supabase
      .from("messages")
      .insert([{ lead_id: selectedLead.id, role: "outbound", content: text }])

    if (!error) {
      setReplyText("")
    }
    // Message is added via Supabase realtime subscription — do NOT add to state here
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 w-full max-w-full overflow-hidden bg-neutral-950 text-white">
      <div className="w-[320px] border-r border-zinc-800 flex-shrink-0 overflow-y-auto">
        <div className="p-4 text-lg font-semibold">Inbox</div>

        {leads.map((lead) => (
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
                  <span className="text-xs text-gray-400 shrink-0">
                    {lead.temperature}
                  </span>
                </div>

                <div className="text-sm text-gray-400 mt-1 truncate">
                  {lead.last_message}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-green-400">{lead.score ?? "—"}</span>
                  <span className="text-xs text-gray-500">/100</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {leads.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No leads yet</div>
        )}
      </div>

      <div className="flex-1 min-w-0 min-h-0 flex px-4 py-4 overflow-hidden gap-4">
        {selectedLead ? (
          <>
            {/* Conversation panel: flex col, messages scroll, reply fixed at bottom */}
            <div className="flex flex-col h-full min-h-0 flex-1 min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
                <div className="text-xs tracking-wide text-zinc-500 uppercase">Conversation</div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth px-4 py-4 space-y-4">
                {messages.length === 0 ? (
                  <>
                    <p className="text-sm text-zinc-500">No conversation yet</p>
                    <div ref={messagesEndRef} />
                  </>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === "outbound" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={
                            msg.role === "outbound"
                              ? "bg-blue-600 text-white p-4 rounded-2xl rounded-br-md max-w-[min(85%,28rem)] text-base leading-relaxed"
                              : "bg-neutral-800 text-white p-4 rounded-2xl rounded-bl-md max-w-[min(85%,28rem)] text-base leading-relaxed"
                          }
                        >
                          {msg.content ?? "—"}
                        </div>
                      </div>
                    ))}
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
              <div className="p-4 border-b border-zinc-800 text-sm font-semibold uppercase tracking-wider text-zinc-500">
                AI Reply Suggestions
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
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-base text-zinc-400">Score</span>
                    <span className="text-xl font-semibold text-white">{selectedLead.score ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-base text-zinc-400">Intent</span>
                    <span className="text-base font-medium text-zinc-200">{selectedLead.temperature}</span>
                  </div>
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
                  <div>• {leads.length} New Leads</div>
                  <div>• {leads.filter((l) => l.temperature === "🟡 Warm" || l.temperature === "🔥 Hot").length} Warm Lead{leads.filter((l) => l.temperature === "🟡 Warm" || l.temperature === "🔥 Hot").length !== 1 ? "s" : ""}</div>
                  <div>• 0 Replies Needed</div>
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
                  <div>• Follow up with warm leads</div>
                  <div>• Send pricing breakdown</div>
                  <div>• Ask qualifying question</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
