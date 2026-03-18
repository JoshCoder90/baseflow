import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ error: "Campaign ID required" }, { status: 400 })
  }

  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: SUPABASE_SERVICE_KEY missing" },
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

  const { error: updateError } = await supabase
    .from("campaigns")
    .update({ status: "stopped" })
    .eq("id", campaignId)

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Failed to stop campaign" },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, status: "stopped" })
}
