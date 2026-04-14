import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  INPUT_MAX,
  validateText,
  validateUuid,
} from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

export const runtime = "nodejs"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    const { id: campaignIdRaw } = await params
    const vCamp = validateUuid(campaignIdRaw, "campaign id")
    if (!vCamp.ok) return vCamp.response
    const campaignId = vCamp.value

    const body = await req.json()
    const vn = validateText(body.notes, {
      required: false,
      maxLen: INPUT_MAX.long,
      field: "notes",
    })
    if (!vn.ok) return vn.response

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ notes: vn.value })
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
