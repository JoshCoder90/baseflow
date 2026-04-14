import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getCampaign } from "@/lib/get-campaign"
import { processCampaignSendQueueOnce } from "@/lib/process-campaign-send-queue-once"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

/**
 * Process one queued send for this campaign (manual trigger or legacy client call).
 * Production sending runs via POST /api/process-send-queue (cron / Supabase / npm run queue-worker).
 */
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

    if (!supabaseServiceKey) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const campaign = await getCampaign(supabase, campaignId, user.id)
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
    }

    const result = await processCampaignSendQueueOnce(supabase, campaignId, user.id)

    if (result.skipped && result.reason === "campaign_not_active") {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "campaign not active",
          campaignStatus: result.campaignStatus,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    return NextResponse.json({
      success: true,
      processed: result.processed,
      campaignStatus: result.campaignStatus,
      skipped: result.skipped,
      reason: result.reason,
      rejected: result.rejected,
    })
  } catch (err) {
    console.error("process-send-queue:", err)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
