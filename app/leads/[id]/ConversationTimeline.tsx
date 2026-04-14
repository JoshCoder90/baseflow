"use client"

import type { RefObject } from "react"

type Message = {
  id: string
  role: "outbound" | "inbound" | string
  content?: string | null
  channel?: string | null
  created_at?: string | null
}

type Props = {
  messages: Message[]
  embedded?: boolean
  messagesEndRef?: RefObject<HTMLDivElement | null>
}

export function ConversationTimeline({ messages, embedded, messagesEndRef }: Props) {
  const header = (
    <div className="shrink-0 border-b border-zinc-800 px-4 py-3 pr-24">
      <div className="text-xs uppercase tracking-wide text-zinc-500">Conversation</div>
    </div>
  )

  if (messages.length === 0) {
    const content = (
      <>
        <h2 className="mb-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Conversation
        </h2>
        <p className="text-sm text-zinc-500">No conversation yet</p>
      </>
    )
    if (embedded) {
      return (
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {header}
          <div className="conversation-scroll flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto overflow-x-hidden px-4 py-3 pr-2">
            <p className="text-sm text-zinc-500">No conversation yet</p>
            {messagesEndRef && <div ref={messagesEndRef} />}
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-sm text-zinc-500">No conversation yet</p>
      </div>
    )
  }

  const messagesList = (
    <>
      {messages.map((msg) => {
        const time = msg.created_at
          ? new Date(msg.created_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : ""

        if (msg.role === "outbound") {
          return (
            <div key={msg.id} className="flex flex-col items-end">
              <span className="mb-1.5 text-xs font-medium text-zinc-500">
                YOU
                {msg.channel === "email" && " • EMAIL"}
                {time && ` • ${time}`}
              </span>
              <div className="max-w-[min(85%,28rem)] rounded-2xl rounded-br-md bg-blue-600 px-5 py-4 text-base leading-relaxed text-white shadow-lg shadow-blue-900/25">
                <p className="whitespace-pre-wrap">{msg.content ?? "—"}</p>
              </div>
            </div>
          )
        }

        if (msg.role === "inbound" || msg.role === "lead") {
          return (
            <div key={msg.id} className="flex flex-col items-start">
              <span className="mb-1.5 text-xs font-medium text-zinc-500">
                LEAD
                {time && ` • ${time}`}
              </span>
              <div className="max-w-[min(85%,28rem)] rounded-2xl rounded-bl-md border border-zinc-600 bg-zinc-700 px-5 py-4 text-base leading-relaxed text-zinc-100">
                <p className="whitespace-pre-wrap">{msg.content ?? "—"}</p>
              </div>
            </div>
          )
        }

        return (
          <div key={msg.id} className="flex flex-col items-start">
            <span className="mb-1.5 text-xs font-medium text-zinc-500">
              LEAD
              {time && ` • ${time}`}
            </span>
            <div className="max-w-[min(85%,28rem)] rounded-2xl rounded-bl-md border border-zinc-600 bg-zinc-700 px-5 py-4 text-base leading-relaxed text-zinc-100">
              <p className="whitespace-pre-wrap">{msg.content ?? "—"}</p>
            </div>
          </div>
        )
      })}
      {messagesEndRef && <div ref={messagesEndRef} />}
    </>
  )

  if (embedded) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {header}
        <div className="conversation-scroll flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto overflow-x-hidden px-6 py-4 pr-2">
          {messagesList}
        </div>
      </div>
    )
  }

  const content = (
    <>
      <h2 className="mb-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Conversation
      </h2>
      <div className="space-y-6">{messagesList}</div>
    </>
  )

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 sm:p-8">
      {content}
    </div>
  )
}
