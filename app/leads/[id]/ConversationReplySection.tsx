"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { ConversationTimeline } from "./ConversationTimeline"
import { ReplyBox } from "./ReplyBox"
import { AIReplySuggestion } from "./AIReplySuggestion"

type Message = {
  id: string
  role: "outbound" | "inbound"
  content?: string | null
  created_at?: string | null
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

    const { data, error } = await supabase
      .from("messages")
      .insert({
        lead_id: leadId,
        campaign_id: campaignId ?? null,
        role: "outbound",
        content: text,
      })
      .select("*")
      .single()

    if (error) {
      console.error("Insert error:", error)
      return
    }
    if (data) {
      const newMessage = data as Message
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMessage.id)) return prev
        return [...prev, newMessage]
      })
      setReply("")
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
              <ReplyBox embedded reply={reply} setReply={setReply} onSendReply={handleSendReply} />
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
