import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  insertCampaignLeads,
  SCRAPER_MAX_ROWS_PER_CAMPAIGN,
} from "@/lib/campaign-leads-insert"
import {
  INPUT_MAX,
  validateText,
  validateUuid,
} from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

/**
 * Fetches leads for a campaign. Leads are saved with either campaign_id or audience_id.
 * Never filters by campaign status - leads load for active, paused, and stopped campaigns.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const { id: campaignIdRaw } = await params
  const vCampGet = validateUuid(campaignIdRaw, "campaign id")
  if (!vCampGet.ok) return vCampGet.response
  const campaignId = vCampGet.value

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""
  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: SUPABASE_SERVICE_KEY missing" },
      { status: 500 }
    )
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id, audience_id")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  // Leads are saved with campaign_id (new flow) or audience_id (legacy)
  // Try campaign_id first, then audience_id - never filter by campaign status
  let leads: { id: string; name: string | null; email: string | null; status: string | null; company: string | null; website?: string | null }[] = []

  const { data: leadsByCampaign } = await supabase
    .from("leads")
    .select("id, name, email, status, company, website")
    .eq("campaign_id", campaignId)
    .order("name")

  if (leadsByCampaign && leadsByCampaign.length > 0) {
    leads = leadsByCampaign
  } else if (campaign.audience_id) {
    const { data: leadsByAudience } = await supabase
      .from("leads")
      .select("id, name, email, status, company, website")
      .eq("audience_id", campaign.audience_id)
      .order("name")
    leads = leadsByAudience ?? []
  }

  return NextResponse.json({ leads })
}

/**
 * Create a lead for a campaign (server-side dedupe by email + row cap matches generate-leads).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const { id: campaignIdRaw } = await params
  const vCamp = validateUuid(campaignIdRaw, "campaign id")
  if (!vCamp.ok) return vCamp.response
  const campaignId = vCamp.value

  const serverClient = await createServerClient()
  const {
    data: { user },
  } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""
  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: SUPABASE_SERVICE_KEY missing" },
      { status: 500 }
    )
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const vName = validateText(body.name, {
    required: false,
    maxLen: INPUT_MAX.short,
    field: "name",
  })
  if (!vName.ok) return vName.response
  const vEmail = validateText(body.email, {
    required: false,
    maxLen: INPUT_MAX.email,
    field: "email",
  })
  if (!vEmail.ok) return vEmail.response
  const vCompany = validateText(body.company, {
    required: false,
    maxLen: INPUT_MAX.short,
    field: "company",
  })
  if (!vCompany.ok) return vCompany.response
  const vStatus = validateText(body.status, {
    required: false,
    maxLen: INPUT_MAX.short,
    field: "status",
  })
  if (!vStatus.ok) return vStatus.response
  const vTag = validateText(body.tag, {
    required: false,
    maxLen: INPUT_MAX.short,
    field: "tag",
  })
  if (!vTag.ok) return vTag.response

  const name = vName.value.length > 0 ? vName.value : null
  const email = vEmail.value.length > 0 ? vEmail.value : null
  const company = vCompany.value.length > 0 ? vCompany.value : null
  const status = vStatus.value.length > 0 ? vStatus.value : "New"
  const tag = vTag.value.length > 0 ? vTag.value : null

  const result = await insertCampaignLeads(
    supabase,
    campaignId,
    [
      {
        user_id: user.id,
        name,
        email,
        company,
        status,
        tag,
      },
    ],
    {
      select: "id, name, email, website, status, company",
      maxRowsForCampaign: SCRAPER_MAX_ROWS_PER_CAMPAIGN,
    }
  )

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 })
  }
  if (result.skipped || result.reason === "max_reached") {
    return NextResponse.json({ error: "Lead limit reached" }, { status: 409 })
  }
  if (result.reason === "invalid_contact") {
    return NextResponse.json(
      { error: "Add an email or website" },
      { status: 400 }
    )
  }
  if (result.reason === "duplicate_email" || !result.rows?.[0]) {
    return NextResponse.json(
      { error: "A lead with this contact already exists in this campaign" },
      { status: 409 }
    )
  }

  const lead = result.rows[0] as {
    id: string
    name: string | null
    email: string | null
    website: string | null
    status: string | null
    company: string | null
  }

  return NextResponse.json({ lead })
}
