type Message = {
  id: string
  role: "outbound" | "inbound"
  content?: string | null
  channel?: string | null
  created_at?: string | null
}

type Props = {
  messages: Message[]
  embedded?: boolean
  messagesEndRef?: React.RefObject<HTMLDivElement | null>
}

export function ConversationTimeline({ messages, embedded, messagesEndRef }: Props) {
  const header = (
    <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
      <div className="text-xs tracking-wide text-zinc-500 uppercase">
        Conversation
      </div>
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
        <>
          {header}
          <div className="conversation-scroll space-y-4 max-h-[350px] overflow-y-auto overflow-x-hidden px-4 py-3 pr-2">
            <p className="text-sm text-zinc-500">No conversation yet</p>
            {messagesEndRef && <div ref={messagesEndRef} />}
          </div>
        </>
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
        const isOutbound = msg.role === "outbound"
        const label = isOutbound ? "YOU" : "LEAD"
        const time = msg.created_at
          ? new Date(msg.created_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : ""

        return (
          <div
            key={msg.id}
            className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
          >
            <span className="mb-1.5 text-xs font-medium text-zinc-500">
              {label}
              {isOutbound && (msg.channel === "sms" || msg.channel === "email") && ` • ${msg.channel.toUpperCase()}`}
              {time && ` • ${time}`}
            </span>
            <div
              className={`max-w-[min(85%,28rem)] rounded-2xl px-5 py-4 text-base leading-relaxed ${
                isOutbound
                  ? "rounded-br-md bg-blue-600/20 border border-blue-500/30 text-white"
                  : "rounded-bl-md bg-zinc-800 border border-zinc-700 text-zinc-200"
              }`}
            >
              <p className="whitespace-pre-wrap">
                {msg.content ?? "—"}
              </p>
            </div>
          </div>
        )
      })}
      {messagesEndRef && <div ref={messagesEndRef} />}
    </>
  )

  if (embedded) {
    return (
      <>
        {header}
        <div className="conversation-scroll space-y-4 max-h-[350px] overflow-y-auto overflow-x-hidden px-6 py-4 pr-2">
          {messagesList}
        </div>
      </>
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
