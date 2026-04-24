"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { CampaignStatusBadge } from "./CampaignStatusBadge"
import { CampaignDetailsEditor } from "./CampaignDetailsEditor"
import { CampaignProgressBar } from "./CampaignProgressBar"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  audience_id?: string | null
  channel?: string | null
  audiences?: {
    id: string
    name: string | null
    niche: string | null
    location: string | null
    leads_collected?: number | null
  } | null
  message_template?: string | null
  subject?: string | null
  status?: string | null
}

type Props = {
  campaign: Campaign
  leadCount: number
  /** When true, open edit mode (e.g. from "Edit Messages" in lead gen complete) */
  requestEdit?: boolean
  /** Call when edit mode has been opened in response to requestEdit */
  onEditConsumed?: () => void
}

function getTargetLabel(campaign: Campaign): string {
  if (campaign.target_search_query) return campaign.target_search_query
  const a = campaign.audiences
  if (a) return `${a.niche || a.name || "—"} – ${a.location || "—"}`
  return campaign.target_audience ?? "—"
}

export function CampaignDetailClient({
  campaign,
  leadCount,
  requestEdit,
  onEditConsumed,
}: Props) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  /** "idle" | "starting" (HTTP) | "awaiting_active" (OK, waiting for status active/sending/completed). */
  const [startSendingUi, setStartSendingUi] = useState<"idle" | "starting" | "awaiting_active">("idle")
  const [stopping, setStopping] = useState(false)
  const [resuming, setResuming] = useState(false)

  useEffect(() => {
    if (requestEdit && onEditConsumed) {
      setIsEditing(true)
      onEditConsumed()
    }
  }, [requestEdit, onEditConsumed])

  const targetLabel = getTargetLabel(campaign)
  const status = (campaign.status ?? "draft").toLowerCase()

  useEffect(() => {
    if (startSendingUi !== "awaiting_active") return
    if (status === "active" || status === "sending" || status === "completed") {
      setStartSendingUi("idle")
    }
  }, [startSendingUi, status])

  async function handleStartSending() {
    if (status === "active") return
    if (startSendingUi !== "idle") return
    setStartSendingUi("starting")
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start-sending`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to start sending")
      setStartSendingUi("awaiting_active")
      router.refresh()
    } catch {
      setStartSendingUi("idle")
    }
  }

  async function handleStopCampaign() {
    setStopping(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/stop-campaign`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to stop")
      router.refresh()
    } catch {
      // Could add toast/error state
    } finally {
      setStopping(false)
    }
  }

  async function handleResumeCampaign() {
    setResuming(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start-sending`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to resume")
      router.refresh()
    } catch {
      // Could add toast/error state
    } finally {
      setResuming(false)
    }
  }

  if (isEditing) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Edit campaign
        </h2>
        <CampaignDetailsEditor
          campaignId={campaign.id}
          messageTemplate={campaign.message_template ?? null}
          subject={campaign.subject ?? null}
          targetAudience={targetLabel}
          audienceNiche={campaign.audiences?.niche ?? campaign.audiences?.name ?? campaign.target_search_query ?? campaign.target_audience ?? undefined}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false)
            router.refresh()
          }}
          editMode
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Target</p>
          <p className="text-sm font-medium text-white truncate" title={targetLabel}>
            {targetLabel}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Leads</p>
          <p className="text-sm font-medium text-white">{leadCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Status</p>
          <div className="flex flex-wrap items-center gap-2">
            {status === "running" && <CampaignStatusBadge status="running" />}
            {status === "completed" && <CampaignStatusBadge status="completed" />}
            {!["running", "completed"].includes(status) && (
              <CampaignStatusBadge status={campaign.status} />
            )}
          </div>
        </div>
      </div>

      {/* Campaign progress bar */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/30 px-5 py-3">
        <CampaignProgressBar
          messagesConfigured={!!(campaign.message_template?.trim())}
          leadsGenerated={leadCount >= 1}
          campaignRunning={status === "active" || status === "sending"}
        />
      </div>

      {/* Message Preview */}
      <section className="rounded-2xl border border-zinc-700/80 bg-zinc-900/40 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Initial Message
        </h2>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 shadow-lg">
            <span className="text-xs font-medium text-blue-200 mb-1 block">You →</span>
            <p className="text-sm text-white whitespace-pre-wrap">
              {campaign.message_template ?? "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pt-2">
        {(status === "active" || status === "sending") && (
          <button
            type="button"
            onClick={handleStopCampaign}
            disabled={stopping}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 transition disabled:opacity-50"
          >
            {stopping ? "Stopping…" : "Stop Campaign"}
          </button>
        )}
        {status === "paused" && (
          <button
            type="button"
            onClick={handleResumeCampaign}
            disabled={resuming}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
          >
            {resuming ? "Resuming…" : "Resume Campaign"}
          </button>
        )}
        {status !== "active" && status !== "paused" && (
          <button
            type="button"
            onClick={handleStartSending}
            disabled={startSendingUi !== "idle"}
            aria-busy={startSendingUi !== "idle"}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
          >
            {startSendingUi === "starting"
              ? "Starting…"
              : startSendingUi === "awaiting_active"
                ? "Running…"
                : "Start Sending Messages"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-600 bg-zinc-800/80 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition"
        >
          Edit Campaign
        </button>
      </div>
    </div>
  )
}
