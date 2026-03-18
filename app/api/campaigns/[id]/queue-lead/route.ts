import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { personalizeMessage } from "@/lib/lead-personalization"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params
    const body = await req.json().catch(() => ({}))
    const leadId = body?.leadId

    if (!campaignId || !leadId) {
      return NextResponse.json({ error: "campaignId and leadId required" }, { status: 400 })
    }

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
      .select("id, user_id, message_template, subject, follow_up_schedule")
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

    if (lead.status === "messaged") {
      return NextResponse.json({ error: "Lead already messaged" })
    }

    const { data: existingMessages } = await supabase
      .from("campaign_messages")
      .select("id, status, step_number")
      .eq("lead_id", leadId)
      .eq("campaign_id", campaignId)

    type FollowUpStep = { day: number; type: string; template?: string }
    function parseFollowUpSchedule(raw: string | null | undefined): FollowUpStep[] {
      if (!raw || typeof raw !== "string") return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    const followUps = parseFollowUpSchedule(campaign.follow_up_schedule)
    const messageTemplate = campaign.message_template?.trim() || "Hey {{first_name}}, I wanted to reach out. Would love to connect!"

    type QueueStep = { delayDays: number; step: number; template: string }
    const steps: QueueStep[] = [{ delayDays: 0, step: 1, template: messageTemplate }]
    for (let j = 0; j < followUps.length; j++) {
      const fu = followUps[j]
      const delayDays = fu.day >= 1 ? fu.day : [2, 4, 7][j] ?? 7
      steps.push({
        delayDays,
        step: j + 2,
        template: (fu.template?.trim() || messageTemplate) as string,
      })
    }

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
        channel: "email",
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
