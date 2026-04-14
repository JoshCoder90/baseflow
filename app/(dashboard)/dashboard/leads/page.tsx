import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { fetchCampaignsWithLeadCounts } from "@/lib/fetch-campaigns-with-lead-counts"
import { AddLeadModal } from "@/app/leads/AddLeadModal"
import { CampaignHubGrid } from "@/app/leads/CampaignHubGrid"

export default async function LeadsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const campaigns = await fetchCampaignsWithLeadCounts(supabase, user.id)

  return (
    <div className="max-w-6xl">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Leads</h1>
          <p className="mt-1 text-zinc-400">Browse leads by campaign—open a campaign for the full list.</p>
        </div>
        <AddLeadModal />
      </header>

      <CampaignHubGrid campaigns={campaigns} campaignLeadsPathPrefix="/dashboard/leads/campaign" />
    </div>
  )
}
