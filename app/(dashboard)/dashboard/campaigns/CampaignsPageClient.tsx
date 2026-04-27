"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { CampaignCard } from "./components/CampaignCard"
import { DeleteCampaignModal } from "./components/DeleteCampaignModal"
import { EmptyCampaignState } from "./components/EmptyCampaignState"

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
  /** Live count from `campaign_messages` (queued / sending / pending), same as campaign detail queue. */
  queue_not_sent?: number | null
}

type Props = {
  initialCampaigns: Campaign[]
}

export function CampaignsPageClient({ initialCampaigns }: Props) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns)
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null)

  const refetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns/list-data", { cache: "no-store" })
      if (!res.ok) return
      const payload = (await res.json()) as { campaigns?: Campaign[] }
      if (Array.isArray(payload.campaigns)) {
        setCampaigns(payload.campaigns)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    console.log("Campaign loaded once — no polling")
    void refetchCampaigns()
  }, [refetchCampaigns])

  async function handleDeleteCampaign(campaignId: string) {
    await supabase.from("campaigns").delete().eq("id", campaignId)
    setCampaigns((prev) => prev.filter((c) => c.id !== campaignId))
    setDeleteTarget(null)
    router.refresh()
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Campaigns</h1>
            <p className="mt-1 text-zinc-500">Create and manage outbound campaigns</p>
          </div>
          <Link
            href="/dashboard/campaigns/new"
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition shrink-0"
          >
            New Campaign
          </Link>
        </header>

        <div className="grid grid-cols-4 gap-6 mb-8">
          <div className="flex flex-col gap-2 rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-600/20 to-purple-900/20 bg-zinc-800/60 p-6 text-white shadow-xl shadow-black/20 transition duration-200 hover:scale-[1.02]">
            <p className="text-sm uppercase tracking-wide text-neutral-300">Total Campaigns</p>
            <p className="text-3xl font-semibold tabular-nums">{campaigns.length}</p>
            <p className="text-xs text-emerald-400">+0 this week</p>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-600/20 to-blue-900/20 bg-zinc-800/60 p-6 text-white shadow-xl shadow-black/20 transition duration-200 hover:scale-[1.02]">
            <p className="text-sm uppercase tracking-wide text-neutral-300">Active Campaigns</p>
            <p className="text-3xl font-semibold tabular-nums">
              {
                campaigns.filter(
                  (c) => c.status === "active" || c.status === "sending"
                ).length
              }
            </p>
            <p className="text-xs text-emerald-400">+0 this week</p>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-600/20 to-cyan-900/20 bg-zinc-800/60 p-6 text-white shadow-xl shadow-black/20 transition duration-200 hover:scale-[1.02]">
            <p className="text-sm uppercase tracking-wide text-neutral-300">Replies</p>
            <p className="text-3xl font-semibold tabular-nums">0</p>
            <p className="text-xs text-emerald-400">+0% this week</p>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-600/20 to-green-900/20 bg-zinc-800/60 p-6 text-white shadow-xl shadow-black/20 transition duration-200 hover:scale-[1.02]">
            <p className="text-sm uppercase tracking-wide text-neutral-300">Interested Leads</p>
            <p className="text-3xl font-semibold tabular-nums">0</p>
            <p className="text-xs text-emerald-400">+0% this week</p>
          </div>
        </div>

        {campaigns.length === 0 ? (
          <EmptyCampaignState onNewCampaign={() => router.push("/dashboard/campaigns/new")} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onDelete={(c) => setDeleteTarget(c)}
                />
              ))}
            </div>
            {campaigns.length < 3 && (
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <p className="text-sm text-zinc-400">
                  You have {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}. Create another to diversify your outreach.
                </p>
                <Link
                  href="/dashboard/campaigns/new"
                  className="mt-3 text-sm font-medium text-blue-400 hover:text-blue-300 transition inline-block"
                >
                  + New Campaign
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      <DeleteCampaignModal
        campaign={deleteTarget}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteCampaign}
      />
    </div>
  )
}
