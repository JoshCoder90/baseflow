"use client"

import { useState, useEffect } from "react"
import { CampaignStatusBadge } from "./CampaignStatusBadge"

function formatTimeUntil(sendAt: string | null): string {
  if (!sendAt) return "—"
  try {
    const now = new Date()
    const target = new Date(sendAt)
    const diffMs = target.getTime() - now.getTime()

    if (diffMs <= 0) return "Sending now"

    const totalMinutes = Math.floor(diffMs / (1000 * 60))
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
    const days = Math.floor(totalHours / 24)

    if (days >= 1) {
      return `${days}d`
    }

    const hours = totalHours
    const minutes = totalMinutes % 60

    if (hours === 0) {
      return `${minutes}m`
    }
    return `${hours}h ${minutes}m`
  } catch {
    return "—"
  }
}

type Props = {
  status: string
  currentPhase: string
  messagesSent: number
  repliesCount: number
  nextScheduledAt: string | null
  leadsRemaining: number
}

function PhaseBadge({ phase }: { phase: string }) {
  const styles: Record<string, string> = {
    "Initial Messages": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    Bump: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    Nudge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "Follow-up": "bg-purple-500/15 text-purple-400 border-purple-500/30",
    "Final Check-in": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    Completed: "bg-zinc-600/60 text-zinc-300 border-zinc-500/50",
    "Sending...": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    Paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  }
  const style = styles[phase] ?? styles["Initial Messages"]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {phase}
    </span>
  )
}

export function CampaignActivity({
  status,
  currentPhase,
  messagesSent,
  repliesCount,
  nextScheduledAt,
  leadsRemaining,
}: Props) {
  const [, setRefresh] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setRefresh((prev) => !prev)
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
        Campaign Activity
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div>
          <p className="text-xs text-zinc-500 mb-1">Status</p>
          <CampaignStatusBadge status={status} />
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Current Phase</p>
          <PhaseBadge phase={currentPhase} />
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Messages Sent</p>
          <p className="text-sm font-medium text-white tabular-nums">{messagesSent}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Replies Received</p>
          <p className="text-sm font-medium text-white tabular-nums">{repliesCount}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Next Scheduled Message</p>
          <p className="text-sm font-medium text-white tabular-nums">{formatTimeUntil(nextScheduledAt)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Leads Remaining</p>
          <p className="text-sm font-medium text-white tabular-nums">{leadsRemaining}</p>
        </div>
      </div>
    </div>
  )
}
