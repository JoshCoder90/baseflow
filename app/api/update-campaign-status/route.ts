import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"

/** POST { campaignId, status } — updates `campaigns.status` for the authenticated user only. */
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { campaignId?: string; status?: string }
  try {
    body = (await req.json()) as { campaignId?: string; status?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : ""
  const status = typeof body.status === "string" ? body.status.trim() : ""

  if (!campaignId || !status) {
    return NextResponse.json(
      { error: "campaignId and status are required" },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from("campaigns")
    .update({ status })
    .eq("id", campaignId)
    .eq("user_id", user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
