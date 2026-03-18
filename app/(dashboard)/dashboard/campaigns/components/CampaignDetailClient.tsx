"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignStatusBadge } from "./CampaignStatusBadge"
import { CampaignDetailsEditor } from "./CampaignDetailsEditor"
import { CampaignProgressBar } from "./CampaignProgressBar"

const TYPE_LABELS: Record<string, string> = {
  bump: "Bump",
  nudge: "Nudge",
  followup: "Follow-Up",
  final: "Final Check-in",
}

function parseFollowUps(raw: string | null | undefined): { day: number; type: string; template?: string }[] {
  if (raw == null) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

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
  follow_up_schedule?: string | null
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

function FollowUpTimeline({ steps, initialMessage }: { steps: { day: number; type: string; template?: string }[]; initialMessage?: string | null }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([1]))

  function toggle(day: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  const allSteps = [
    { day: 1, type: "Initial Message", template: initialMessage ?? undefined },
    ...steps,
  ]

  return (
    <div className="relative">
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-zinc-700/80" />
      <div className="space-y-0">
        {allSteps.map((step, i) => {
          const isExpanded = expanded.has(step.day)
          return (
            <div key={`${step.day}-${i}`} className="relative pl-10 pb-6 last:pb-0">
              <div className="absolute left-0 top-1 w-[22px] h-[22px] rounded-full bg-zinc-800 border-2 border-blue-500 flex items-center justify-center">
                <span className="text-[10px] font-semibold text-blue-400">{step.day}</span>
              </div>
              <button
                type="button"
                onClick={() => toggle(step.day)}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-zinc-700/80 bg-zinc-800/50 px-4 py-3 text-left hover:bg-zinc-800/70 transition"
              >
                <span className="text-sm font-medium text-white">Day {step.day}</span>
                <span className="text-sm text-zinc-400">{TYPE_LABELS[step.type] ?? step.type}</span>
                <svg
                  className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExpanded && (
                <div className="mt-2 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-3">
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                    {step.template ?? "—"}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CampaignDetailClient({
  campaign,
  leadCount,
  requestEdit,
  onEditConsumed,
}: Props) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [resuming, setResuming] = useState(false)

  useEffect(() => {
    if (requestEdit && onEditConsumed) {
      setIsEditing(true)
      onEditConsumed()
    }
  }, [requestEdit, onEditConsumed])

  const targetLabel = getTargetLabel(campaign)
  const status = campaign.status ?? "draft"
  const followUps = parseFollowUps(campaign.follow_up_schedule)

  async function handleStartSending() {
    if (status === "active") return
    setStarting(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start-sending`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to start sending")
      router.refresh()
    } catch {
      // Could add toast/error state
    } finally {
      setStarting(false)
    }
  }

  async function handleStopCampaign() {
    setStopping(true)
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "paused" })
        .eq("id", campaign.id)
      if (error) throw error
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
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "active" })
        .eq("id", campaign.id)
      if (error) throw error
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
          channel={campaign.channel}
          messageTemplate={campaign.message_template ?? null}
          followUpSchedule={campaign.follow_up_schedule ?? null}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Channel</p>
          <p className="text-sm font-medium text-white capitalize">
            {campaign.channel === "auto"
              ? "Auto (SMS or Email)"
              : (campaign.channel ?? "SMS").toUpperCase()}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Status</p>
          <CampaignStatusBadge status={status} />
        </div>
      </div>

      {/* Campaign progress bar */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/30 px-5 py-3">
        <CampaignProgressBar
          messagesConfigured={!!(campaign.message_template?.trim())}
          leadsGenerated={leadCount >= 1}
          campaignRunning={status === "active"}
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

      {/* Follow-up timeline */}
      <section className="rounded-2xl border border-zinc-700/80 bg-zinc-900/40 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-5">
          Follow-up schedule
        </h2>
        <FollowUpTimeline steps={followUps} initialMessage={campaign.message_template} />
      </section>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pt-2">
        {status === "active" && (
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
            disabled={starting}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start Sending Messages"}
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
