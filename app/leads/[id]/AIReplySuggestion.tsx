"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { emailBodyToPlainPreview } from "@/lib/email-body-display"

type MessageRow = { role: string; content?: string | null }

type Props = {
  leadId: string
  onInsertReply?: (text: string) => void
}

export function AIReplySuggestion({ leadId, onInsertReply }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const suggestionsRequestId = useRef(0)

  const generateSuggestions = useCallback(async (id: string) => {
    const req = ++suggestionsRequestId.current
    setLoadingSuggestions(true)
    setSuggestions([])
    try {
      const res = await fetch(
        `/api/messages?lead_id=${encodeURIComponent(id)}`,
        { credentials: "include", cache: "no-store" }
      )
      if (req !== suggestionsRequestId.current) return
      if (!res.ok) {
        setSuggestions([])
        return
      }
      const data = (await res.json()) as { messages?: MessageRow[] }
      const rows = Array.isArray(data.messages) ? data.messages : []
      if (rows.length === 0) {
        setSuggestions([])
        return
      }

      const mappedMessages = rows.map((m) => ({
        role: m.role === "inbound" || m.role === "lead" ? "user" : "assistant",
        content: emailBodyToPlainPreview(m.content ?? "") || "",
      }))

      const aiRes = await fetch("/api/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: mappedMessages }),
      })
      const replyData = (await aiRes.json()) as { reply?: string; error?: string }
      if (!aiRes.ok) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[AIReplySuggestion] generate-reply:", replyData.error ?? aiRes.status)
        }
        if (req === suggestionsRequestId.current) setSuggestions([])
        return
      }
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
    if (!leadId) return
    void generateSuggestions(leadId)
  }, [leadId, generateSuggestions])

  function handleRegenerate() {
    void generateSuggestions(leadId)
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 mt-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm text-zinc-400">AI REPLY SUGGESTIONS</h3>
        <button
          type="button"
          disabled={loadingSuggestions}
          onClick={handleRegenerate}
          className="text-xs text-blue-400 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Regenerate
        </button>
      </div>

      {loadingSuggestions ? (
        <div className="bg-blue-950/40 p-3 rounded-md text-sm text-blue-200">Generating...</div>
      ) : suggestions.length === 0 ? (
        <div className="bg-blue-950/40 p-3 rounded-md text-sm text-blue-200">No suggestion yet</div>
      ) : (
        <div className="space-y-4">
          {suggestions.map((text, i) => (
            <div key={i} className="bg-blue-950/40 p-3 rounded-md">
              <p className="text-xs font-medium text-zinc-500 mb-1.5">Reply Option {i + 1}</p>
              <p className="text-sm text-blue-200 whitespace-pre-wrap mb-2">{text.trim()}</p>
              <button
                type="button"
                onClick={() => onInsertReply?.(text.trim())}
                className="px-3 py-1 text-sm border border-zinc-700 rounded-md hover:bg-zinc-800 transition"
              >
                Insert Reply
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
