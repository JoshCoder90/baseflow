import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { fetchCampaignsWithLeadCounts } from "@/lib/fetch-campaigns-with-lead-counts"
import { AddLeadModal } from "./AddLeadModal"
import { CampaignHubGrid } from "./CampaignHubGrid"

export default async function LeadsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const campaigns = await fetchCampaignsWithLeadCounts(supabase, user.id)

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
          <Link href="/" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </Link>
          <Link href="/dashboard/campaigns" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13a3 3 0 100-6M12 19h.01" />
            </svg>
            Campaigns
          </Link>
          <Link href="/leads" className="flex items-center gap-3 rounded-xl bg-zinc-800/80 px-4 py-3 text-sm font-medium text-white border border-zinc-700/50 whitespace-nowrap">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Leads
          </Link>
          <Link href="/inbox" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Inbox
          </Link>
        </nav>
        <div className="hidden lg:flex p-4 space-y-2 border-t border-zinc-800 flex-col">
          <div className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Plan</p>
            <p className="text-sm font-semibold text-white mt-0.5">Growth</p>
          </div>
          <div className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Health</p>
            <p className="text-sm font-semibold text-emerald-400 mt-0.5">Good</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
          <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Leads</h1>
              <p className="mt-1 text-zinc-400">Browse leads by campaign—open a campaign for the full list.</p>
            </div>
            <AddLeadModal />
          </header>

          <CampaignHubGrid campaigns={campaigns} campaignLeadsPathPrefix="/leads/campaign" />
        </div>
      </main>
    </div>
  )
}
