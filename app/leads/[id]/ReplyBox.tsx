"use client"

import { useState } from "react"

type Props = {
  embedded?: boolean
  reply?: string
  setReply?: (value: string) => void
  onSendReply?: (content: string) => void
}

export function ReplyBox({ embedded, reply: replyProp, setReply: setReplyProp, onSendReply }: Props) {
  const [internalReply, setInternalReply] = useState("")
  const reply = replyProp !== undefined ? replyProp : internalReply
  const setReply = setReplyProp ?? setInternalReply

  function handleSend() {
    const text = reply.trim()
    if (!text) return
    onSendReply?.(text)
    setReply("")
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
          onClick={handleSend}
          className="h-[36px] px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition shrink-0"
        >
          Send
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
