import Link from "next/link"
import { CampaignStatusBadge } from "./CampaignStatusBadge"

type FollowUpStep = { day: number; type: string }
type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  follow_up_schedule?: string | FollowUpStep[] | null
  status?: string | null
  created_at?: string | null
}

function parseFollowUpPreview(
  raw: string | FollowUpStep[] | null | undefined
): string {
  if (raw == null) return ""
  let steps: FollowUpStep[] = []
  if (Array.isArray(raw)) steps = raw
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      steps = Array.isArray(parsed) ? parsed : []
    } catch {
      return ""
    }
  }
  const labels: Record<string, string> = {
    nudge: "Nudge",
    followup: "Follow-up",
    final: "Final Check-in",
  }
  return steps
    .filter((s) => s.day >= 3)
    .map((s) => `Day ${s.day} ${labels[s.type] ?? s.type}`)
    .join(" • ")
}

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const created = campaign.created_at
    ? new Date(campaign.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—"
  const followUpPreview = parseFollowUpPreview(campaign.follow_up_schedule)

  return (
    <Link
      href={`/dashboard/campaigns/${campaign.id}`}
      className="group block rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-neutral-700 hover:bg-neutral-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-white truncate group-hover:text-blue-400 transition">
            {campaign.name ?? "Untitled campaign"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500 truncate">
            {campaign.target_audience ?? "No target audience"}
          </p>
          <p className="mt-2 text-xs text-zinc-600">{created}</p>
        </div>
        <CampaignStatusBadge status={campaign.status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
        <span>0 Messages Sent</span>
        <span>0 Replies</span>
        <span>0 Interested Leads</span>
      </div>

      {followUpPreview && (
        <p className="mt-3 text-xs text-zinc-500 truncate">{followUpPreview}</p>
      )}

      <div className="mt-4">
        <span className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white group-hover:bg-blue-500 transition">
          Open Campaign
        </span>
      </div>
    </Link>
  )
}
