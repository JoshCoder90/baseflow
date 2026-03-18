import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params
    if (!campaignId) {
      return NextResponse.json({ error: "Campaign ID required" }, { status: 400 })
    }

    const { notes } = await req.json()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ notes: notes ?? "" })
      .eq("id", campaignId)
      .eq("user_id", user.id)

    if (error) {
      console.error("Campaign notes save error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Save campaign notes error:", error)
    const message = error instanceof Error ? error.message : "Save failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
