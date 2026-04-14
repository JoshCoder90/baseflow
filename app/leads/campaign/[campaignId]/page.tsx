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

export default async function CampaignLeadsPage({
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white lg:flex-row">
      <aside className="w-full lg:w-64 flex-shrink-0 bg-zinc-900/98 border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-row lg:flex-col">
        <div className="p-4 lg:p-6 border-b-0 lg:border-b border-r lg:border-r-0 border-zinc-800/80 flex items-center lg:block">
          <Link href="/" className="text-xl font-bold tracking-tight text-white hover:opacity-90">
            BaseFlow
          </Link>
          <p className="hidden lg:block text-xs text-zinc-500 mt-0.5 tracking-wide">Automation control</p>
        </div>
        <nav className="flex-1 flex lg:flex-col gap-0 p-2 lg:p-4 space-y-0 lg:space-y-1 overflow-x-auto">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap"
          >
            Dashboard
          </Link>
          <Link
            href="/leads"
            className="flex items-center gap-3 rounded-xl bg-zinc-800/80 px-4 py-3 text-sm font-medium text-white border border-zinc-700/50 whitespace-nowrap"
          >
            Leads
          </Link>
          <Link
            href="/inbox"
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap"
          >
            Inbox
          </Link>
        </nav>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
          <Link
            href="/leads"
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

          <CampaignLeadsClient leads={leads} leadDetailBasePath="/leads" />
        </div>
      </main>
    </div>
  )
}
