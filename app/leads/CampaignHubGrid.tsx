import Link from "next/link"
import { CampaignStatusBadge } from "@/app/(dashboard)/dashboard/campaigns/components/CampaignStatusBadge"
import type { CampaignWithLeadCount } from "@/lib/fetch-campaigns-with-lead-counts"

type Props = {
  campaigns: CampaignWithLeadCount[]
  /** e.g. `/leads/campaign` or `/dashboard/leads/campaign` (no trailing slash) */
  campaignLeadsPathPrefix: string
}

export function CampaignHubGrid({ campaigns, campaignLeadsPathPrefix }: Props) {
  if (campaigns.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 px-6 py-14 text-center">
        <p className="text-zinc-400">No campaigns yet. Create a campaign to start collecting leads.</p>
        <Link
          href="/dashboard/campaigns/new"
          className="mt-4 inline-block text-sm font-medium text-sky-400 hover:text-sky-300"
        >
          New campaign →
        </Link>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {campaigns.map((campaign) => (
        <div
          key={campaign.id}
          className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-white">{campaign.name ?? "Untitled campaign"}</h2>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <p className="text-sm text-zinc-400">
              {campaign.leadCount === 1 ? "1 lead" : `${campaign.leadCount} leads`}
            </p>
          </div>
          <Link
            href={`${campaignLeadsPathPrefix}/${campaign.id}`}
            className="shrink-0 text-sm font-medium text-sky-400 transition hover:text-sky-300 hover:underline"
          >
            View leads →
          </Link>
        </div>
      ))}
    </div>
  )
}
