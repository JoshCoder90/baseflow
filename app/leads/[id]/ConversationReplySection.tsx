"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { GMAIL_RECONNECT_REQUIRED } from "@/lib/gmail-reconnect-client"
import { recordOutboundConversationRow } from "@/lib/record-outbound-conversation"
import { ConversationTimeline } from "./ConversationTimeline"
import { ReplyBox } from "./ReplyBox"
import { AIReplySuggestion } from "./AIReplySuggestion"

type Message = {
  id: string
  role: "outbound" | "inbound" | string
  content?: string | null
  created_at?: string | null
  thread_id?: string | null
  campaign_id?: string | null
}

export function ConversationReplySection({
  leadId,
  campaignId,
}: {
  leadId: string
  campaignId?: string | null
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false)
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  useEffect(() => {
    if (isFullscreen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [isFullscreen])

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/messages?lead_id=${encodeURIComponent(leadId)}`,
        { credentials: "include", cache: "no-store" }
      )
      if (!res.ok) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[ConversationReplySection] /api/messages failed:", res.status)
        }
        return
      }
      const data = (await res.json()) as { messages?: Message[] }
      if (Array.isArray(data.messages)) {
        setMessages(data.messages)
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[ConversationReplySection] fetchMessages:", err)
      }
    }
  }, [leadId])

  useEffect(() => {
    void fetchMessages()
  }, [leadId, fetchMessages])

  useEffect(() => {
    const channel = supabase
      .channel(`messages-realtime-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev
            return [...prev, newMessage]
          })
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("bf-lead-messages-changed", { detail: { leadId } })
            )
          }
          fetch("/api/detect-deal-stage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId }),
          }).catch(console.error)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [leadId])

  async function handleSendReply(content: string) {
    const text = content.trim()
    if (!text) return

    const threadId =
      [...messages].reverse().find((m) => m.thread_id?.trim())?.thread_id?.trim() ?? ""

    if (!threadId) {
      window.alert(
        "No Gmail thread is linked to this conversation yet. Wait for the first campaign email to send (or open Inbox after Gmail sync), then try again."
      )
      throw new Error("no-thread")
    }

    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .select("email")
      .eq("id", leadId)
      .maybeSingle()

    if (leadErr || !leadRow?.email?.trim()) {
      window.alert(
        !leadRow?.email?.trim()
          ? "This contact has no email address. Add an email on the lead to send."
          : "Could not load this lead. Try refreshing the page."
      )
      throw new Error("no-email")
    }
    const toEmail = leadRow.email.trim()

    setSending(true)
    try {
      const sendRes = await fetch("/api/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: toEmail,
          subject: "Re:",
          message: text,
          threadId,
        }),
      })
      const sendPayload = (await sendRes.json().catch(() => ({}))) as {
        error?: string
        success?: boolean
      }

      if (!sendRes.ok) {
        const errMsg = sendPayload.error ?? "Failed to send email"
        if (
          errMsg === GMAIL_RECONNECT_REQUIRED ||
          errMsg.includes(GMAIL_RECONNECT_REQUIRED)
        ) {
          window.alert(
            "Gmail needs to be reconnected. Open Connections and reconnect your account."
          )
        } else {
          window.alert(errMsg)
        }
        throw new Error("send-failed")
      }

      const campaignForInsert =
        campaignId ??
        (messages.find((m) => m.campaign_id)?.campaign_id as string | null | undefined) ??
        null

      const { data, error } = await supabase
        .from("messages")
        .insert({
          lead_id: leadId,
          campaign_id: campaignForInsert,
          role: "outbound",
          content: text,
          thread_id: threadId,
        })
        .select("*")
        .single()

      if (error) {
        console.error("[ConversationReplySection] messages insert after Gmail send:", error)
        window.alert(
          "Your message was sent via Gmail but could not be saved to this timeline. Check your Sent mail and Inbox; it may appear after the next sync."
        )
        throw new Error("insert-failed")
      }

      const newMessage = data as Message
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMessage.id)) return prev
        return [...prev, newMessage]
      })

      const lastActivityAt = newMessage.created_at ?? new Date().toISOString()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await recordOutboundConversationRow(supabase, {
          userId: user.id,
          threadId,
          lastActivityAt,
        })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div
          className={`relative flex flex-col overflow-hidden transition-all duration-300 ${
            isFullscreen
              ? "fixed inset-0 z-50 flex flex-col bg-black/90 p-6 backdrop-blur-md"
              : "h-[500px] rounded-xl border border-zinc-800 bg-zinc-900/40"
          }`}
        >
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="absolute right-3 top-3 z-[60] rounded-lg bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
          >
            {isFullscreen ? "Minimize" : "Expand"}
          </button>

          <div
            className={`flex min-h-0 flex-1 flex-col ${isFullscreen ? "mx-auto w-full max-w-4xl" : ""}`}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ConversationTimeline messages={messages} embedded messagesEndRef={messagesEndRef} />
            </div>
            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/40 p-3">
              <ReplyBox
                embedded
                reply={reply}
                setReply={setReply}
                onSendReply={handleSendReply}
                sending={sending}
              />
            </div>
          </div>
        </div>

        <div>
          <AIReplySuggestion leadId={leadId} onInsertReply={setReply} />
        </div>
      </div>
    </>
  )
}
