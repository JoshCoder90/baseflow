import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveChannel, type CampaignChannel } from "@/lib/campaign-send"

/**
 * Send a campaign message to a lead.
 * Resolves channel (sms/email/auto) and stores message. Actual delivery is stubbed.
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { campaign_id: campaignId, lead_id: leadId, content } = body

  if (!campaignId || !leadId || !content?.trim()) {
    return NextResponse.json(
      { error: "campaign_id, lead_id, and content are required" },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id, audience_id, channel")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, audience_id, campaign_id, phone, email")
    .eq("id", leadId)
    .single()

  const leadInCampaign =
    lead &&
    (lead.campaign_id === campaignId ||
      (campaign.audience_id != null && lead.audience_id === campaign.audience_id))

  if (leadError || !leadInCampaign) {
    return NextResponse.json({ error: "Lead not found in campaign" }, { status: 404 })
  }

  const channel = resolveChannel(
    (campaign.channel as CampaignChannel) ?? "sms",
    { id: lead.id, phone: lead.phone, email: lead.email }
  )

  if (!channel) {
    return NextResponse.json(
      {
        error:
          "Lead has no phone (for SMS) or email (for Email). Update campaign channel or add contact info.",
      },
      { status: 400 }
    )
  }

  // TODO: Actual delivery via Twilio (SMS) or Resend (Email)
  // if (channel === "sms") await sendSms(lead.phone!, content)
  // if (channel === "email") await sendEmail(lead.email!, content)

  const { data: message, error: insertError } = await supabase
    .from("messages")
    .insert({
      lead_id: leadId,
      role: "outbound",
      content: content.trim(),
      channel,
    })
    .select("id")
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
    channel,
  })
}
