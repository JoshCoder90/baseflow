import { NextRequest, NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getCampaignStats } from "@/lib/get-campaign-stats"
import { validateQueryUuid } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { rateLimitResponse } from "@/lib/rateLimit"

export const dynamic = "force-dynamic"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

const LEADS_PAGE_SIZE = 1000

async function fetchAllLeadsForCampaignScope(
  supabase: SupabaseClient,
  params: {
    campaignId: string
    audienceId: string | null
  }
): Promise<{ data: Record<string, unknown>[]; error: Error | null }> {
  const { campaignId, audienceId } = params

  const { data: probe } = await supabase
    .from("leads")
    .select("id")
    .eq("campaign_id", campaignId)
    .limit(1)

  const hasCampaignLeads = (probe ?? []).length > 0
  const scope: "campaign" | "audience" =
    hasCampaignLeads ? "campaign" : audienceId ? "audience" : "campaign"

  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += LEADS_PAGE_SIZE) {
    const to = from + LEADS_PAGE_SIZE - 1
    let q = supabase
      .from("leads")
      .select("*")
      .order("id", { ascending: true })
      .range(from, to)

    if (scope === "campaign") {
      q = q.eq("campaign_id", campaignId)
    } else if (audienceId) {
      q = q.eq("audience_id", audienceId)
    }

    const { data, error } = await q
    if (error) {
      return { data: [], error: new Error(error.message) }
    }
    const chunk = (data ?? []) as Record<string, unknown>[]
    rows.push(...chunk)
    if (chunk.length < LEADS_PAGE_SIZE) break
  }

  return { data: rows, error: null }
}

/**
 * Live campaign row + all leads for the campaign (paginated server-side, no row cap).
 * Stats: client uses leads.length and email filter — same as Supabase contents.
 */
export async function GET(req: NextRequest) {
  const _ip = heavyRouteIpLimitResponse(req, "campaign-data")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const vId = validateQueryUuid(req.nextUrl.searchParams.get("id"), "id")
  if (!vId.ok) return vId.response
  const campaignId = vId.value

  const serverClient = await createServerClient()
  const {
    data: { user },
  } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select(
      "id, status, lead_generation_status, lead_generation_stage, target_search_query, audience_id"
    )
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const audienceId =
    typeof campaign.audience_id === "string" ? campaign.audience_id : null

  const { data: leadsRaw, error: leadsErr } = await fetchAllLeadsForCampaignScope(supabase, {
    campaignId,
    audienceId,
  })

  if (leadsErr) {
    console.error("[campaign-data] leads fetch error", campaignId, leadsErr)
    return NextResponse.json({ error: "Failed to load leads" }, { status: 500 })
  }

  const queueStats = await getCampaignStats(supabase, campaignId)

  /** Email-only product: do not expose phone in API payloads (column may still exist in DB). */
  const rows = leadsRaw.map((row) => {
    const { phone: _omit, ...rest } = row as Record<string, unknown> & { phone?: unknown }
    return rest
  })

  const { data: queueRaw, error: qErr } = await supabase
    .from("campaign_messages")
    .select(
      "id, lead_id, campaign_id, step_number, status, next_send_at, sent_at, message_body"
    )
    .eq("campaign_id", campaignId)
    .order("id", { ascending: true })

  if (qErr) {
    console.error("[campaign-data] campaign_messages select error", campaignId, qErr)
  }

  const queueList = queueRaw ?? []
  const leadIds = [...new Set(queueList.map((m) => m.lead_id as string))]
  let queueMessages: Record<string, unknown>[] = queueList as Record<string, unknown>[]

  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from("leads")
      .select("id, name, email")
      .in("id", leadIds)

    const leadMap = new Map((leadRows ?? []).map((l) => [l.id as string, l]))
    queueMessages = queueList.map((m) => {
      const lid = m.lead_id as string
      const L = leadMap.get(lid)
      return {
        ...m,
        leads: L ? { name: L.name, email: L.email } : null,
      }
    })
  }

  return NextResponse.json(
    {
      campaign,
      leads: rows,
      queueMessages,
      queueStats,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
  )
}
