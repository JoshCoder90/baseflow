"use client"

import Link from "next/link"
import { CampaignStatusBadge } from "./CampaignStatusBadge"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  audience_id?: string | null
  audiences?: { id: string; name: string | null; niche: string | null; location: string | null } | null
  message_template?: string | null
  status?: string | null
  created_at?: string | null
  sent_count?: number | null
  queue_not_sent?: number | null
}

type Props = {
  campaign: Campaign
  onDelete?: (campaign: Campaign) => void
}

function getTargetLabel(campaign: Campaign): string {
  if (campaign.target_search_query) return campaign.target_search_query
  const a = campaign.audiences
  if (a) return `${a.niche || a.name || "—"} – ${a.location || "—"}`
  return campaign.target_audience ?? "No target defined"
}

export function CampaignCard({ campaign, onDelete }: Props) {
  const sentCount = campaign.sent_count ?? 0
  const queueNotSent = campaign.queue_not_sent ?? 0

  const created = campaign.created_at
    ? new Date(campaign.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—"
  return (
    <Link
      href={`/dashboard/campaigns/${campaign.id}`}
      className="group relative block rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-neutral-700 hover:bg-neutral-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-white truncate group-hover:text-blue-400 transition">
            {campaign.name ?? "Untitled campaign"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500 truncate">
            {getTargetLabel(campaign)}
          </p>
          <p className="mt-2 text-xs text-zinc-600">{created}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CampaignStatusBadge status={campaign.status} />
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete(campaign)
              }}
              className="relative z-10 rounded-lg p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition"
              aria-label="Delete campaign"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
        <span>{sentCount} sent</span>
        <span>{queueNotSent} in queue</span>
        <span>0 replies</span>
        <span>0 interested</span>
      </div>

      <div className="mt-4">
        <span className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white group-hover:bg-blue-500 transition">
          Open Campaign
        </span>
      </div>
    </Link>
  )
}
