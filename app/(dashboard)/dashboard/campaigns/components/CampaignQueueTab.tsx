"use client"

import { useState, useEffect, useRef } from "react"

type QueueItem = {
  id: string
  lead_name: string
  email: string
  status: "pending" | "sent" | "failed"
  scheduled_for: string
  sent_at: string | null
}

type Props = {
  campaignId: string
  activeTab: string
  campaignStatus?: string
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

function getTimeLeft(scheduledAt: string | null, now: number): string | null {
  if (!scheduledAt) return null
  const diff = new Date(scheduledAt).getTime() - now
  if (diff <= 0) return "Sending..."
  const minutes = Math.floor(diff / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function CampaignQueueTab({ campaignId, activeTab, campaignStatus }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState(Date.now())
  const pollingRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const startPolling = async () => {
    if (pollingRef.current) return
    pollingRef.current = true

    const loop = async () => {
      if (!pollingRef.current) return

      try {
        const res = await fetch(`/api/queue?campaign_id=${campaignId}`)
        const data = await res.json()

        setQueue((prev) => {
          if (data?.skipped) return prev
          if (JSON.stringify(prev) === JSON.stringify(data)) return prev
          return Array.isArray(data) ? data : []
        })
      } catch (err) {
        console.error("Queue fetch failed", err)
      } finally {
        setLoading(false)
      }

      setTimeout(loop, 5000)
    }

    loop()
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!campaignId || campaignStatus !== "active") return

    if (activeTab === "queue") {
      startPolling()
    } else {
      pollingRef.current = false
    }

    return () => {
      pollingRef.current = false
    }
  }, [activeTab, campaignId, campaignStatus])

  const nextPendingIso = (queue || []).find((i) => i.status === "pending")?.scheduled_for ?? null
  const nextSendCountdown = getTimeLeft(nextPendingIso, now)
  const queued = (queue || []).filter((i) => i.status === "pending")
  const showTimes = mounted
  const sent = (queue || []).filter((i) => i.status === "sent")
  const failed = (queue || []).filter((i) => i.status === "failed")

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm p-6">
        <p className="text-zinc-500">Loading queue...</p>
      </div>
    )
  }

  if (!queue || queue.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm p-8 text-center">
        <p className="text-zinc-400">
          Your messages will appear here once campaign starts
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
      <div className="p-6 border-b border-zinc-800/80">
        <div className="flex flex-wrap gap-6 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Queued</p>
            <p className="text-xl font-semibold text-yellow-400 tabular-nums">{queued.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Sent</p>
            <p className="text-xl font-semibold text-green-400 tabular-nums">{sent.length}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Failed</p>
            <p className="text-xl font-semibold text-red-400 tabular-nums">{failed.length}</p>
          </div>
          {showTimes && nextPendingIso && nextSendCountdown && (
            <div className="ml-auto">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Next send in</p>
              <p className="text-lg font-semibold text-white">{nextSendCountdown}</p>
            </div>
          )}
        </div>
      </div>

      <div className="divide-y divide-zinc-800/80">
        {(queue || []).map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center gap-4 p-4 hover:bg-zinc-800/30 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white truncate">{item.lead_name || item.email || "—"}</p>
              <p className="text-sm text-zinc-500 truncate">{item.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  item.status === "pending"
                    ? "bg-yellow-500/10 text-yellow-400"
                    : item.status === "sent"
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                }`}
              >
                {item.status === "pending" && "Pending"}
                {item.status === "sent" && "Sent"}
                {item.status === "failed" && "Failed"}
              </span>
              <span className="text-sm text-zinc-400">
                {item.status === "pending" && (showTimes ? `Sends at ${formatTime(item.scheduled_for)}` : "Scheduled")}
                {item.status === "sent" && item.sent_at && (showTimes ? `Sent at ${formatTime(item.sent_at)}` : "Sent")}
                {item.status === "failed" && "Retry queued"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
