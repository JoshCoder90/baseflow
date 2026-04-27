import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { activateCampaignSending } from "@/lib/activate-campaign-sending"
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

    const result = await activateCampaignSending(supabase, campaignId, user.id)

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 500 }
      )
    }

    return NextResponse.json({
      success: true,
      messagesInserted: result.messagesInserted,
      messagesScheduled: result.messagesScheduled,
    })
  } catch (err) {
    console.error("[start-sending] ERROR:", err)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
