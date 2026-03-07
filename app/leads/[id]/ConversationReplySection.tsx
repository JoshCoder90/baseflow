"use client"

import { useState, useEffect, useRef } from "react"
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

export function ConversationReplySection({ leadId }: { leadId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState("")
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [messages])

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })

    if (!error && data) {
      setMessages(data as Message[])
    }
  }

  useEffect(() => {
    loadMessages()
  
    const channel = supabase
      .channel("messages-realtime")
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
          setMessages((prev) => [...prev, newMessage])
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

    const { data, error } = await supabase
      .from("messages")
      .insert([
        {
          lead_id: leadId,
          role: "outbound",
          content: content
        }
      ])
      .select()
  
    if (error) {
      console.error("Insert error:", error)
      return
    }
    const newMessage = data[0]
    setMessages((prev) => [...prev, newMessage])
    setReply("")
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Conversation + Reply as one continuous card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="min-h-[300px] flex flex-col overflow-hidden">
            <ConversationTimeline messages={messages} embedded messagesEndRef={messagesEndRef} />
          </div>
          <div className="border-t border-zinc-800 p-3">
            <ReplyBox embedded reply={reply} setReply={setReply} onSendReply={handleSendReply} />
          </div>
        </div>

        <div>
          <AIReplySuggestion messages={messages} onInsertReply={setReply} />
        </div>
      </div>
    </>
  )
}
