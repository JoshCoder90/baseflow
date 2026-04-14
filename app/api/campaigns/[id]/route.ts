import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const { id: campaignId } = await context.params
  if (!campaignId) {
    return NextResponse.json({ error: "Campaign ID required" }, { status: 400 })
  }

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("*, audiences(id, name, niche, location, leads_collected, target_leads)")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single()

  if (error || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  let sent_count = 0
  const { count: byCampaign } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["sent", "messaged"])
  if ((byCampaign ?? 0) > 0) {
    sent_count = byCampaign ?? 0
  } else if (campaign.audience_id) {
    const { count: byAudience } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("audience_id", campaign.audience_id)
      .in("status", ["sent", "messaged"])
    sent_count = byAudience ?? 0
  }

  return NextResponse.json({
    ...campaign,
    body: campaign.message_template ?? "",
    sent_count,
  })
}
