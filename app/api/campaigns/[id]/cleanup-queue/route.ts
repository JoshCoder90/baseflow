import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { deleteOrphanedCampaignMessages } from "@/lib/campaign-messages-cleanup"
import { validateUuid } from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

/** Removes `campaign_messages` rows whose lead row is gone (after deletes that skipped CASCADE). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(_req)
  if (_rl) return _rl

  const { id: raw } = await params
  const v = validateUuid(raw, "campaign id")
  if (!v.ok) return v.response
  const campaignId = v.value

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

  const { data: camp, error } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (error || !camp) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const removed = await deleteOrphanedCampaignMessages(supabase, campaignId)
  return NextResponse.json({ ok: true, removed })
}
