import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

/**
 * Fetches leads for a campaign. Leads are saved with either campaign_id or audience_id.
 * Never filters by campaign status - leads load for active, paused, and stopped campaigns.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ error: "Campaign ID required" }, { status: 400 })
  }

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
  let leads: { id: string; name: string | null; phone: string | null; email: string | null; status: string | null; company: string | null; website?: string | null }[] = []

  const { data: leadsByCampaign } = await supabase
    .from("leads")
    .select("id, name, phone, email, status, company, website")
    .eq("campaign_id", campaignId)
    .order("name")

  if (leadsByCampaign && leadsByCampaign.length > 0) {
    leads = leadsByCampaign
  } else if (campaign.audience_id) {
    const { data: leadsByAudience } = await supabase
      .from("leads")
      .select("id, name, phone, email, status, company, website")
      .eq("audience_id", campaign.audience_id)
      .order("name")
    leads = leadsByAudience ?? []
  }

  return NextResponse.json({ leads })
}
