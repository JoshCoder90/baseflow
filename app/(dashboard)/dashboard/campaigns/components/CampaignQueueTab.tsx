"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CampaignQueueStats } from "@/lib/get-campaign-stats"

export type CampaignQueueMessageRow = {
  id: string
  lead_id: string
  step_number?: number
  status: string | null
  next_send_at: string | null
  sent_at: string | null
  leads?: { name: string | null; email: string | null } | null
}

type Props = {
  queueMessages?: CampaignQueueMessageRow[]
  /** DB counts from `getCampaignStats` — same as Campaign Activity. */
  queueStats: CampaignQueueStats
  loading?: boolean
  campaignStatus?: string | null
}

/** Naive ISO strings (no Z/offset) are interpreted as UTC so countdown matches server schedule. */
function nextSendAtToMs(nextSendAt: string): number {
  const t = nextSendAt.trim()
  const hasTz = /Z$/i.test(t) || /[+-]\d{2}:?\d{2}$/.test(t)
  const target = new Date(hasTz ? t : `${t}Z`).getTime()
  return target
}

/** Countdown for a future `next_send_at`. If already due, callers should show Sending / trigger send instead. */
function formatQueuedCountdown(nextSendAt: string | null, campaignIsActive: boolean): string {
  if (!campaignIsActive) return "Paused"
  if (!nextSendAt) return "Pending schedule"

  const now = Date.now()
  const target = nextSendAtToMs(nextSendAt)
  const diffMs = target - now

  if (diffMs <= 0) return campaignIsActive ? "Sending now" : "Paused"

  const totalSec = Math.max(1, Math.ceil(diffMs / 1000))
  if (totalSec < 60) {
    return `Sending in ${totalSec}s`
  }
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `Sending in ${minutes}m ${seconds}s`
}

function isDue(row: CampaignQueueMessageRow): boolean {
  if (!row.next_send_at || row.sent_at) return false
  return nextSendAtToMs(row.next_send_at) <= Date.now()
}

export function CampaignQueueTab({
  queueMessages = [],
  queueStats,
  loading,
  campaignStatus,
}: Props) {
  const [tick, setTick] = useState(Date.now())
  const [inflightIds, setInflightIds] = useState<Set<string>>(() => new Set())
  const triggeredRef = useRef<Set<string>>(new Set())

  const tickMs = useMemo(() => {
    const now = Date.now()
    for (const row of queueMessages) {
      if (row.status !== "queued" || !row.next_send_at || row.sent_at) continue
      const msLeft = nextSendAtToMs(row.next_send_at) - now
      if (msLeft <= 2000) return 250
    }
    return 1000
  }, [queueMessages, tick])

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(Date.now())
    }, tickMs)
    return () => clearInterval(interval)
  }, [tickMs])

  const triggerSend = useCallback(async (messageId: string) => {
    if (triggeredRef.current.has(messageId)) return
    triggeredRef.current.add(messageId)
    setInflightIds((prev) => new Set(prev).add(messageId))
    try {
      const res = await fetch("/api/send-email-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      })
      let data: {
        ok?: boolean
        skipped?: boolean
        reason?: string
        error?: string
      } = {}
      try {
        data = (await res.json()) as typeof data
      } catch {
        /* ignore */
      }

      if (res.status === 409 && data?.reason === "campaign_not_active") {
        triggeredRef.current.delete(messageId)
      } else if (!res.ok && res.status >= 500) {
        triggeredRef.current.delete(messageId)
      } else if (data?.skipped && data?.reason === "claim_failed") {
        /* worker won the row — stop retrying */
      }
    } catch {
      triggeredRef.current.delete(messageId)
    } finally {
      setInflightIds((prev) => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
    }
  }, [])

  const campaignIsActive =
    campaignStatus === "active" || campaignStatus === "sending"

  useEffect(() => {
    if (!campaignIsActive) return
    for (const row of queueMessages) {
      if (row.status !== "queued" || !row.next_send_at || row.sent_at) continue
      if (nextSendAtToMs(row.next_send_at) > Date.now()) continue
      if (triggeredRef.current.has(row.id)) continue
      void triggerSend(row.id)
    }
  }, [tick, queueMessages, campaignIsActive, triggerSend])

  const sorted = [...queueMessages].sort((a, b) => {
    if (a.sent_at && !b.sent_at) return 1
    if (!a.sent_at && b.sent_at) return -1
    if (a.status === "sent") return 1
    if (b.status === "sent") return -1

    if (a.status === "sending" && b.status !== "sending") return -1
    if (b.status === "sending" && a.status !== "sending") return 1

    if (!a.next_send_at && !b.next_send_at) return 0
    if (!a.next_send_at) return 1
    if (!b.next_send_at) return -1

    return nextSendAtToMs(a.next_send_at) - nextSendAtToMs(b.next_send_at)
  })

  const nextQueued = sorted.find(
    (m) =>
      (m.status === "queued" || m.status === "pending") &&
      m.next_send_at &&
      !m.sent_at
  )

  const nextSendSummary = (() => {
    if (!nextQueued?.next_send_at) {
      return campaignIsActive
        ? null
        : queueMessages.some((m) => m.status === "queued" || m.status === "pending")
          ? "Paused"
          : null
    }
    if (isDue(nextQueued)) {
      if (!campaignIsActive) return "Paused"
      if (nextQueued.status === "queued") return "Sending now"
      return "Waiting to queue"
    }
    return formatQueuedCountdown(nextQueued.next_send_at, campaignIsActive)
  })()

  if (loading) {
    return (
      <div className="p-6 text-zinc-500">Loading...</div>
    )
  }

  return (
    <div className="space-y-6" data-refresh={tick}>
      <div className="flex flex-wrap gap-6 items-baseline">
        <div className="text-zinc-400">
          Sent: <span className="font-semibold text-green-400">{queueStats.sent}</span>
        </div>
        <div className="text-zinc-400">
          Not Sent: <span className="font-semibold text-yellow-400">{queueStats.notSent}</span>
        </div>
        <div className="text-zinc-400">
          Failed: <span className="font-semibold text-red-400">{queueStats.failed}</span>
        </div>
        {nextSendSummary !== null && (
          <div className="text-sm text-gray-400">
            Next send — {nextSendSummary}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {sorted.map((row) => {
          const name = row.leads?.name ?? null
          const email = row.leads?.email ?? null

          const due = isDue(row)
          const inflight = inflightIds.has(row.id)
          const showSendingNow =
            row.status === "sending" ||
            inflight ||
            (campaignIsActive && row.status === "queued" && due)

          let label: string
          if (row.status === "sent" || row.sent_at) {
            label = "Sent"
          } else if (showSendingNow) {
            label = "Sending now"
          } else if (row.status === "failed") {
            label = "Failed"
          } else if (row.status === "pending" && !row.next_send_at) {
            label = "Pending schedule"
          } else if (row.status === "pending" && row.next_send_at) {
            if (!campaignIsActive) label = "Paused"
            else if (due) label = "Waiting to queue"
            else label = formatQueuedCountdown(row.next_send_at, campaignIsActive)
          } else if (row.status === "queued" || row.status === "pending") {
            label = formatQueuedCountdown(row.next_send_at ?? null, campaignIsActive)
          } else {
            label = "—"
          }

          const statusLabel =
            row.status === "sent" || row.sent_at ? (
              <span className="text-green-400">{label}</span>
            ) : showSendingNow ? (
              <span className="text-blue-400">{label}</span>
            ) : row.status === "failed" ? (
              <span className="text-red-400">{label}</span>
            ) : (
              <span
                className={
                  label === "Pending schedule" ||
                  label === "Paused" ||
                  label === "Waiting to queue"
                    ? "text-gray-400"
                    : "text-yellow-400"
                }
              >
                {label}
              </span>
            )

          return (
            <div
              key={row.id}
              className="flex justify-between items-center p-4 border border-white/10 rounded-xl bg-white/5"
            >
              <div>
                <div className="text-white">{name || "—"}</div>
                <div className="text-sm text-gray-400">{email || "—"}</div>
              </div>

              <div>{statusLabel}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
