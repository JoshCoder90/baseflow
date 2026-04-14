import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { processQueue } from "@/lib/process-queue-batch"
import { validateQueryUuid } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function GET(req: NextRequest) {
  const _ip = heavyRouteIpLimitResponse(req, "queue")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const url = new URL(req.url)
  const vCamp = validateQueryUuid(url.searchParams.get("campaign_id"), "campaign_id")
  if (!vCamp.ok) return vCamp.response
  const campaignId = vCamp.value

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: SUPABASE_SERVICE_KEY missing" },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id, status")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  if (campaign?.status === "active" || campaign?.status === "sending") {
    try {
      await processQueue()
    } catch (e) {
      console.error("Queue process error:", e)
    }
  }

  const { data: statusRow } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .single()

  const campaignStatus = (statusRow?.status as string | undefined) ?? campaign.status

  const { data: messages, error: messagesError } = await supabase
    .from("campaign_messages")
    .select("id, lead_id, status, send_at, sent_at, step_number")
    .eq("campaign_id", campaignId)
    .order("send_at", { ascending: true })

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 })
  }

  const leadIds = [...new Set((messages ?? []).map((m) => m.lead_id))]
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email")
    .in("id", leadIds)

  const leadMap = new Map((leads ?? []).map((l) => [l.id, l]))

  const items = (messages ?? []).map((m) => {
    const lead = leadMap.get(m.lead_id)
    return {
      id: m.id,
      lead_name: lead?.name ?? "—",
      email: lead?.email ?? "—",
      status: m.status as "pending" | "sent" | "failed",
      scheduled_for: m.send_at,
      sent_at: m.sent_at,
      step_number: m.step_number ?? 1,
    }
  })

  const pending = items.filter((i) => i.status === "pending")
  const sent = items.filter((i) => i.status === "sent")
  const failed = items.filter((i) => i.status === "failed")

  const sorted = [...pending, ...sent, ...failed]

  return NextResponse.json({
    messages: sorted,
    campaignStatus,
  })
}
