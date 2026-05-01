import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  loadCampaignRowForLeadsListPage,
  loadLeadsRowsForCampaignList,
} from "@/lib/load-campaign-for-leads-list-page"
import { AddLeadModal } from "@/app/leads/AddLeadModal"
import { CampaignLeadsClient, type CampaignLeadRow } from "@/app/leads/CampaignLeadsClient"
import { MAX_LEADS_PER_CAMPAIGN } from "@/lib/campaign-leads-insert"

export default async function DashboardCampaignLeadsPage({
  params,
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const campaign = await loadCampaignRowForLeadsListPage(supabase, campaignId, user.id)
  if (!campaign) {
    notFound()
  }

  const leads = (await loadLeadsRowsForCampaignList(
    supabase,
    campaignId
  )) as CampaignLeadRow[]

  return (
    <div className="max-w-6xl">
      <Link
        href="/dashboard/leads"
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition"
      >
        ← Back to campaigns
      </Link>

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
            {campaign.shell ? "Campaign leads" : (campaign.name ?? "Campaign leads")}
          </h1>
          <p className="mt-1 text-zinc-400">Leads attached to this campaign.</p>
        </div>
        <AddLeadModal
          campaignId={campaignId}
          maxRowsPerCampaign={MAX_LEADS_PER_CAMPAIGN}
          isAtLimit={leads.length >= MAX_LEADS_PER_CAMPAIGN}
          buttonClassName="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition shadow-lg shadow-black/20"
        />
      </header>

      <CampaignLeadsClient
        leads={leads}
        leadDetailBasePath="/dashboard/leads"
        campaignId={campaignId}
      />
    </div>
  )
}
