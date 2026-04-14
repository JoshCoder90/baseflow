import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { personalizeMessage } from "@/lib/lead-personalization"
import { isValidEmail } from "@/lib/campaign-message-insert-email"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import { validateUuid } from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    const { id: campaignIdRaw } = await params
    const vCamp = validateUuid(campaignIdRaw, "campaign id")
    if (!vCamp.ok) return vCamp.response
    const campaignId = vCamp.value

    const body = await req.json().catch(() => ({}))
    const vl = validateUuid(body?.leadId, "leadId")
    if (!vl.ok) return vl.response
    const leadId = vl.value

    if (!supabaseServiceKey) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }

    const serverClient = await createServerClient()
    const { data: { user } } = await serverClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, user_id, message_template, subject")
      .eq("id", campaignId)
      .single()

    if (campaignError || !campaign || campaign.user_id !== user.id) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, name, email, status, company")
      .eq("id", leadId)
      .eq("campaign_id", campaignId)
      .single()

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    }

    if (!lead.email) {
      return NextResponse.json({ error: "Lead has no email" })
    }

    if (!isValidEmail(lead.email)) {
      console.log("Filtered invalid email:", lead.email)
      console.log("Filtered emails:", 1)
      return NextResponse.json(
        { error: "Invalid email address", rejected: true },
        { status: 400 }
      )
    }

    if (!isEmailAllowedForCampaignQueue(lead.email)) {
      console.log(`Rejected invalid email before queue: ${lead.email}`)
      await supabase
        .from("leads")
        .update({ status: "invalid_email" })
        .eq("id", leadId)
      return NextResponse.json(
        { error: "Invalid email address", rejected: true },
        { status: 400 }
      )
    }

    if (lead.status === "invalid_email") {
      await supabase.from("leads").update({ status: "cold" }).eq("id", leadId)
    }

    if (lead.status === "sent") {
      return NextResponse.json({ error: "Lead already messaged" })
    }

    const { data: existingMessages } = await supabase
      .from("campaign_messages")
      .select("id, status, step_number")
      .eq("lead_id", leadId)
      .eq("campaign_id", campaignId)

    const messageTemplate = campaign.message_template?.trim() || "Hey {{first_name}}, I wanted to reach out. Would love to connect!"
    const steps = [{ delayDays: 0, step: 1, template: messageTemplate }]

    const existingByStep = new Map(
      (existingMessages ?? []).map((m) => [m.step_number, { id: m.id, status: m.status }])
    )
    if (existingByStep.has(1)) {
      const s1 = existingByStep.get(1)!
      if (s1.status === "sent" || s1.status === "failed") {
        return NextResponse.json({ error: "Already sent or failed", queued: false })
      }
    }

    const allStepsExist = steps.every((s) => existingByStep.has(s.step))
    if (allStepsExist) {
      return NextResponse.json({ success: true, queued: true, message: "Already in queue" })
    }

    const now = new Date()
    let insertedCount = 0
    for (const { delayDays, step, template } of steps) {
      if (existingByStep.has(step)) continue

      const messageBody = personalizeMessage(template, lead)
      const sendAt = new Date(
        now.getTime() + delayDays * 24 * 60 * 60 * 1000
      ).toISOString()

      const { error: insertErr } = await supabase.from("campaign_messages").insert({
        lead_id: leadId,
        campaign_id: campaignId,
        step_number: step,
        channel: OUTBOUND_EMAIL_CHANNEL,
        message_body: messageBody,
        send_at: sendAt,
        status: "pending",
      })
      if (!insertErr) insertedCount++
    }

    return NextResponse.json({ success: true, queued: true })
  } catch (err) {
    console.error("Queue lead error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
