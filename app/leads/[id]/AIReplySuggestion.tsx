"use client"

import { useState, useEffect } from "react"

type Message = { role: string; content?: string | null }

type Props = {
  messages: Message[]
  onInsertReply?: (text: string) => void
}

export function AIReplySuggestion({ messages, onInsertReply }: Props) {
  const [replyText, setReplyText] = useState("")
  const [loading, setLoading] = useState(false)

  async function generateReply() {
    setLoading(true)
    try {
      const res = await fetch("/api/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      })
      const data = await res.json()
      setReplyText(data.reply ?? "")
    } catch {
      setReplyText("")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    generateReply()
  }, [messages])

  const options = replyText
    ? replyText
        .split(/OPTION \d+:\s*/i)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 mt-6">
      <h3 className="text-sm text-zinc-400 mb-2">
        AI REPLY SUGGESTIONS
      </h3>

      {loading ? (
        <div className="bg-blue-950/40 p-3 rounded-md text-sm text-blue-200">
          Generating...
        </div>
      ) : options.length === 0 ? (
        <div className="bg-blue-950/40 p-3 rounded-md text-sm text-blue-200">
          No suggestion yet
        </div>
      ) : (
        <div className="space-y-4">
          {options.map((text, i) => (
            <div key={i} className="bg-blue-950/40 p-3 rounded-md">
              <p className="text-xs font-medium text-zinc-500 mb-1.5">
                Reply Option {i + 1}
              </p>
              <p className="text-sm text-blue-200 whitespace-pre-wrap mb-2">
                {text.trim()}
              </p>
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

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={generateReply}
          disabled={loading}
          className="px-3 py-1 text-sm border border-zinc-700 rounded-md hover:bg-zinc-800 transition disabled:opacity-50"
        >
          Regenerate
        </button>
      </div>
    </div>
  )
}
