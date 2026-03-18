import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { audience_id: audienceId, lead_ids: leadIds } = body

  if (!audienceId || !Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json(
      { error: "audience_id and lead_ids (array) are required" },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify audience belongs to user
  const { data: audience, error: audienceError } = await supabase
    .from("audiences")
    .select("id, user_id")
    .eq("id", audienceId)
    .single()

  if (audienceError || !audience || audience.user_id !== user.id) {
    return NextResponse.json({ error: "Audience not found" }, { status: 404 })
  }

  // Delete only leads that belong to this audience (security)
  const { data: deleted, error: deleteError } = await supabase
    .from("leads")
    .delete()
    .eq("audience_id", audienceId)
    .in("id", leadIds)
    .select("id")

  if (deleteError) {
    console.error("Bulk delete error:", deleteError)
    return NextResponse.json(
      { error: deleteError.message ?? "Failed to delete leads" },
      { status: 500 }
    )
  }

  const deletedCount = deleted?.length ?? 0

  // Update audience leads_collected
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("audience_id", audienceId)

  await supabase
    .from("audiences")
    .update({ leads_collected: count ?? 0 })
    .eq("id", audienceId)

  return NextResponse.json({
    success: true,
    deleted: deletedCount,
  })
}
