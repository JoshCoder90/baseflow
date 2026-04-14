import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { applyCampaignSendSchedule } from "@/lib/campaign-schedule"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(_req)
  if (_rl) return _rl

  try {
    const campaignId = (await context.params).id

    const serverClient = await createServerClient()
    const {
      data: { user },
    } = await serverClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: campaign, error: campaignFetchError } = await supabase
      .from("campaigns")
      .select("id, user_id")
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .single()

    if (campaignFetchError || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
    }

    const { messagesInserted, messagesScheduled } = await applyCampaignSendSchedule(
      supabase,
      campaignId
    )

    const { error: activeErr } = await supabase
      .from("campaigns")
      .update({ status: "active", channel: OUTBOUND_EMAIL_CHANNEL })
      .eq("id", campaignId)
      .eq("user_id", user.id)

    if (activeErr) {
      console.error("[start-sending] failed to set campaign active:", activeErr)
      return NextResponse.json(
        { error: activeErr.message ?? "Failed to update campaign" },
        { status: 500 }
      )
    }
    console.log(
      "[start-sending] campaign_messages inserted:",
      messagesInserted,
      "scheduled:",
      messagesScheduled
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[start-sending] ERROR:", err)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
