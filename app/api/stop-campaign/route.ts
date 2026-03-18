import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(req: NextRequest) {
  console.log("STOP CAMPAIGN HIT")

  let body: { campaignId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const campaignId = body.campaignId
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 })
  }

  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_KEY missing" },
      { status: 500 }
    )
  }

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  await supabase
    .from("campaigns")
    .update({ status: "paused" })
    .eq("id", campaignId)

  console.log("Campaign stopped:", campaignId)

  return NextResponse.json({ stopped: true, success: true })
}
