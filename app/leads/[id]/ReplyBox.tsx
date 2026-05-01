"use client"

import { useState } from "react"

type Props = {
  embedded?: boolean
  reply?: string
  setReply?: (value: string) => void
  onSendReply?: (content: string) => void | Promise<void>
  /** When true, Send is disabled (e.g. Gmail send in progress). */
  sending?: boolean
}

export function ReplyBox({
  embedded,
  reply: replyProp,
  setReply: setReplyProp,
  onSendReply,
  sending = false,
}: Props) {
  const [internalReply, setInternalReply] = useState("")
  const reply = replyProp !== undefined ? replyProp : internalReply
  const setReply = setReplyProp ?? setInternalReply

  async function handleSend() {
    const text = reply.trim()
    if (!text || sending) return
    try {
      await onSendReply?.(text)
      setReply("")
    } catch {
      /* parent surfaced error */
    }
  }

  const content = (
    <>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        Reply to Lead
      </h2>
      <div className="flex gap-2 items-end">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply to the lead..."
          rows={2}
          className="flex-1 rounded-md bg-zinc-900 border border-zinc-800 p-2 text-sm text-white placeholder:text-zinc-500 resize-none outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending}
          className="h-[36px] px-3 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none text-sm font-medium text-white transition shrink-0"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </>
  )

  if (embedded) {
    return <div className="space-y-2">{content}</div>
  }

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      {content}
    </div>
  )
}
