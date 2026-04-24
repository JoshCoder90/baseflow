import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { CampaignDetailContent } from "../components/CampaignDetailContent"
import { CampaignStatusBadge } from "../components/CampaignStatusBadge"

const PAGE_DEBUG = "campaign_detail"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  leads_found?: number | null
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
  status?: string | null
  notes?: string | null
  created_at?: string | null
  sent_count?: number | null
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

function emptyCampaignShell(campaignId: string): Campaign {
  return {
    id: campaignId,
    name: null,
    target_audience: null,
    target_search_query: null,
    leads_found: null,
    audience_id: null,
    channel: null,
    audiences: null,
    message_template: null,
    status: null,
    notes: null,
    created_at: null,
    sent_count: null,
  }
}

/**
 * STEP A: `campaigns` row only for this user.
 * STEP B: audience + sent count in parallel; failures → log + fallbacks (never 404).
 */
async function loadCampaignForDetailPage(
  supabase: SupabaseClient,
  campaignId: string,
  authenticatedUserId: string
): Promise<Campaign> {
  console.log(`[${PAGE_DEBUG}] load`, {
    page: PAGE_DEBUG,
    requestedId: campaignId,
    authenticatedUserId,
  })

  const {
    data: campaignRow,
    error: campaignErr,
  } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", authenticatedUserId)
    .maybeSingle()

  console.log(`[${PAGE_DEBUG}] main row`, {
    page: PAGE_DEBUG,
    requestedId: campaignId,
    authenticatedUserId,
    mainRowFound: Boolean(campaignRow),
    mainQueryError: campaignErr?.message ?? null,
  })

  if (campaignErr) {
    console.error(`[${PAGE_DEBUG}] campaigns query error`, {
      requestedId: campaignId,
      authenticatedUserId,
      error: campaignErr,
    })
  }

  if (!campaignRow) {
    if (!campaignErr) {
      notFound()
    }
    console.log(`[${PAGE_DEBUG}] using shell after primary query error`, {
      requestedId: campaignId,
      authenticatedUserId,
    })
    return emptyCampaignShell(campaignId)
  }

  const audienceId = campaignRow.audience_id as string | null | undefined

  const [audienceRes, leadsCountRes] = await Promise.all([
    audienceId
      ? supabase
          .from("audiences")
          .select("id, name, niche, location, leads_collected, target_leads")
          .eq("id", audienceId)
          .maybeSingle()
      : Promise.resolve({ data: null as null, error: null as null }),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["sent", "messaged"]),
  ])

  let audiences: Campaign["audiences"] = null
  if (audienceId) {
    if (audienceRes.error) {
      console.error(`[${PAGE_DEBUG}] secondary audiences query error`, {
        requestedId: campaignId,
        authenticatedUserId,
        audienceId,
        error: audienceRes.error,
      })
    } else {
      audiences = audienceRes.data as Campaign["audiences"]
    }
  }

  let sentCount: number | null =
    (campaignRow as { sent_count?: number | null }).sent_count ?? null
  if (leadsCountRes.error) {
    console.error(`[${PAGE_DEBUG}] secondary leads count query error`, {
      requestedId: campaignId,
      authenticatedUserId,
      error: leadsCountRes.error,
    })
  } else if (typeof leadsCountRes.count === "number") {
    sentCount = leadsCountRes.count
  }

  return {
    ...(campaignRow as Campaign),
    audiences,
    sent_count: sentCount ?? 0,
  }
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const authenticatedUserId = user?.id ?? ""
  if (!authenticatedUserId) {
    redirect("/login")
  }

  const campaign = await loadCampaignForDetailPage(supabase, id, authenticatedUserId)

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
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {(campaign.status ?? "").toLowerCase() === "running" && (
              <CampaignStatusBadge status="running" />
            )}
            {(campaign.status ?? "").toLowerCase() === "completed" && (
              <CampaignStatusBadge status="completed" />
            )}
            {!["running", "completed"].includes((campaign.status ?? "").toLowerCase()) && (
              <CampaignStatusBadge status={campaign.status ?? "draft"} />
            )}
          </div>
        </header>

        <CampaignDetailContent campaign={campaign} />
      </div>
    </div>
  )
}
