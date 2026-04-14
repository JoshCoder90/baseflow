import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import {
  INPUT_MAX,
  validateText,
  validateUuid,
} from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

/**
 * Record an outbound message to a lead (email-only). Delivery is stubbed.
 */
export async function POST(req: NextRequest) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const body = await req.json()
  const vc = validateUuid(body.campaign_id, "campaign_id")
  if (!vc.ok) return vc.response
  const vl = validateUuid(body.lead_id, "lead_id")
  if (!vl.ok) return vl.response
  const vcontent = validateText(body.content, {
    required: true,
    maxLen: INPUT_MAX.long,
    field: "content",
  })
  if (!vcontent.ok) return vcontent.response

  const campaignId = vc.value
  const leadId = vl.value
  const content = vcontent.value

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id, audience_id")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, audience_id, campaign_id, email")
    .eq("id", leadId)
    .single()

  const leadInCampaign =
    lead &&
    (lead.campaign_id === campaignId ||
      (campaign.audience_id != null && lead.audience_id === campaign.audience_id))

  if (leadError || !leadInCampaign) {
    return NextResponse.json({ error: "Lead not found in campaign" }, { status: 404 })
  }

  const email = typeof lead.email === "string" ? lead.email.trim() : ""
  if (!email) {
    return NextResponse.json(
      { error: "Lead has no email address. Add an email before sending." },
      { status: 400 }
    )
  }

  const { data: message, error: insertError } = await supabase
    .from("messages")
    .insert({
      lead_id: leadId,
      role: "outbound",
      content,
    })
    .select("*")
    .single()

  if (insertError) {
    console.error("Message insert error:", insertError)
    return NextResponse.json(
      { error: insertError.message ?? "Failed to save message" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    message_id: message?.id,
    channel: OUTBOUND_EMAIL_CHANNEL,
  })
}
