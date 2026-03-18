import Link from "next/link"
import { notFound } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignDetailContent } from "../components/CampaignDetailContent"
import { CampaignStatusBadge } from "../components/CampaignStatusBadge"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  lead_generation_status?: string | null
  audience_id?: string | null
  channel?: string | null
  audiences?: {
    id: string
    name: string | null
    niche: string | null
    location: string | null
    leads_collected?: number | null
    target_leads?: number | null
  } | null
  message_template?: string | null
  follow_up_schedule?: string | null
  status?: string | null
  notes?: string | null
  created_at?: string | null
}

function getNicheLabel(campaign: Campaign): string {
  if (campaign.target_search_query) {
    const q = campaign.target_search_query.trim()
    if (q.includes(" in ")) {
      const [niche, loc] = q.split(/ in /i).map((s) => s.trim())
      return niche && loc ? `${niche} • ${loc}` : q
    }
    return q
  }
  const a = campaign.audiences
  if (a) return `${a.niche || a.name || "—"} • ${a.location || "—"}`
  return campaign.target_audience ?? "—"
}

async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, audiences(id, name, niche, location, leads_collected, target_leads)")
    .eq("id", id)
    .single()

  if (error || !data) return null
  return data as Campaign
}

async function getLeadCount(campaignId: string, audienceId: string | null): Promise<number> {
  const { count: byCampaign } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
  if ((byCampaign ?? 0) > 0) return byCampaign ?? 0
  if (audienceId) {
    const { count: byAudience } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("audience_id", audienceId)
    return byAudience ?? 0
  }
  return 0
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const campaign = await getCampaign(id)
  if (!campaign) notFound()

  const leadCount = await getLeadCount(campaign.id, campaign.audience_id ?? null)
  const nicheLabel = getNicheLabel(campaign)

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <Link
          href="/dashboard/campaigns"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to campaigns
        </Link>

        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              {campaign.name ?? "Untitled campaign"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{nicheLabel}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <CampaignStatusBadge status={campaign.status} />
          </div>
        </header>

        <CampaignDetailContent campaign={campaign} leadCount={leadCount} />
      </div>
    </div>
  )
}
