"use client"

import { useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

type Reply = {
  leadId: string
  leadName: string
  company: string
  messagePreview: string
  messageContent: string
  createdAt: string
  replyStatus: string
}

type Props = {
  campaignId: string
  replies: Reply[]
  onUpdate?: () => void
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return "—"
  }
}

export function CampaignRepliesTab({ replies, onUpdate }: Props) {
  const [updating, setUpdating] = useState<Set<string>>(new Set())

  async function handleAction(leadId: string, action: "interested" | "not_interested" | "archive") {
    setUpdating((prev) => new Set(prev).add(leadId))
    try {
      if (action === "interested") {
        await supabase.from("leads").update({ deal_stage: "Interested" }).eq("id", leadId)
      } else if (action === "not_interested") {
        await supabase.from("leads").update({ deal_stage: "Closed" }).eq("id", leadId)
      } else if (action === "archive") {
        await supabase.from("leads").update({ archived: true }).eq("id", leadId)
      }
      onUpdate?.()
    } finally {
      setUpdating((prev) => {
        const next = new Set(prev)
        next.delete(leadId)
        return next
      })
    }
  }

  if (replies.length === 0) {
    return <p className="text-sm text-zinc-500">No replies yet.</p>
  }

  return (
    <div className="divide-y divide-zinc-700/50">
      {replies.map((r) => (
        <div
          key={r.leadId}
          className="py-4 first:pt-0"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Link
                href={`/dashboard/leads/${r.leadId}`}
                className="font-medium text-white hover:text-blue-400 transition block"
              >
                {r.leadName}
              </Link>
              <p className="text-xs text-zinc-500 mt-0.5">{r.company}</p>
              <p className="mt-2 text-sm text-zinc-400 whitespace-pre-wrap">{r.messageContent || r.messagePreview}</p>
              <p className="mt-1 text-xs text-zinc-500">{formatTimestamp(r.createdAt)}</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  r.replyStatus === "Interested"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : r.replyStatus === "Closed"
                      ? "bg-red-500/15 text-red-400 border-red-500/30"
                      : "bg-purple-500/15 text-purple-400 border-purple-500/30"
                }`}
              >
                {r.replyStatus}
              </span>
              <div className="flex flex-wrap gap-1">
                {r.replyStatus !== "Interested" && (
                  <button
                    type="button"
                    onClick={() => handleAction(r.leadId, "interested")}
                    disabled={updating.has(r.leadId)}
                    className="rounded px-2 py-1 text-xs font-medium bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition disabled:opacity-50"
                  >
                    Mark Interested
                  </button>
                )}
                {r.replyStatus !== "Closed" && (
                  <button
                    type="button"
                    onClick={() => handleAction(r.leadId, "not_interested")}
                    disabled={updating.has(r.leadId)}
                    className="rounded px-2 py-1 text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition disabled:opacity-50"
                  >
                    Mark Not Interested
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleAction(r.leadId, "archive")}
                  disabled={updating.has(r.leadId)}
                  className="rounded px-2 py-1 text-xs font-medium bg-zinc-600/40 text-zinc-400 hover:bg-zinc-600/50 transition disabled:opacity-50"
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
