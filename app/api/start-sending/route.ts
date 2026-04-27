import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { activateCampaignSending } from "@/lib/activate-campaign-sending"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

/** @deprecated Prefer POST `/api/campaigns/[id]/start-sending` — kept for older clients. */
export async function POST(req: Request) {
  const { campaignId } = (await req.json()) as { campaignId?: string }

  if (!campaignId) {
    return NextResponse.json({ error: "Missing campaignId" }, { status: 400 })
  }

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
    ok: true,
    success: true,
    messagesInserted: result.messagesInserted,
    messagesScheduled: result.messagesScheduled,
  })
}
