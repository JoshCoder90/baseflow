import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { validateUuid } from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

/** Delete a lead and all its `campaign_messages` for this campaign (service role — no orphan queue rows). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; leadId: string }> }
) {
  const _rl = rateLimitResponse(_req)
  if (_rl) return _rl

  const { id: campaignRaw, leadId: leadRaw } = await params
  const vCamp = validateUuid(campaignRaw, "campaign id")
  const vLead = validateUuid(leadRaw, "lead id")
  if (!vCamp.ok) return vCamp.response
  if (!vLead.ok) return vLead.response

  const campaignId = vCamp.value
  const leadId = vLead.value

  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
  }

  const serverClient = await createServerClient()
  const {
    data: { user },
  } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: camp, error: campErr } = await supabase
    .from("campaigns")
    .select("id, user_id, audience_id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single()

  if (campErr || !camp) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, campaign_id, audience_id")
    .eq("id", leadId)
    .single()

  if (leadErr || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  const inCampaignScope = lead.campaign_id === campaignId
  const inAudienceScope =
    camp.audience_id != null &&
    lead.audience_id != null &&
    lead.audience_id === camp.audience_id

  if (!inCampaignScope && !inAudienceScope) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  await supabase
    .from("campaign_messages")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("lead_id", leadId)

  const { data: removed, error: delErr } = await supabase
    .from("leads")
    .delete()
    .eq("id", leadId)
    .select("id")

  if (delErr) {
    console.error("[DELETE lead]", delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  if (!removed?.length) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
