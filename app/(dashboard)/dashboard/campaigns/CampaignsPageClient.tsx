"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignCard } from "./components/CampaignCard"
import { EmptyCampaignState } from "./components/EmptyCampaignState"
import { NewCampaignModal } from "./components/NewCampaignModal"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  message_template?: string | null
  follow_up_schedule?: string | null
  status?: string | null
  created_at?: string | null
}

type Props = {
  initialCampaigns: Campaign[]
}

export function CampaignsPageClient({ initialCampaigns }: Props) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns)
  const [modalOpen, setModalOpen] = useState(false)

  async function handleModalClose() {
    setModalOpen(false)
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
    if (data) setCampaigns(data as Campaign[])
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
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition shrink-0"
          >
            New Campaign
          </button>
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
              {campaigns.filter((c) => c.status === "active").length}
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
          <EmptyCampaignState onNewCampaign={() => setModalOpen(true)} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {campaigns.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}
            </div>
            {campaigns.length < 3 && (
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <p className="text-sm text-zinc-400">
                  You have {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}. Create another to diversify your outreach.
                </p>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="mt-3 text-sm font-medium text-blue-400 hover:text-blue-300 transition"
                >
                  + New Campaign
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <NewCampaignModal open={modalOpen} onClose={handleModalClose} />
    </div>
  )
}
