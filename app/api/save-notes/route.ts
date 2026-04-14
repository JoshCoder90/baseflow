import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  INPUT_MAX,
  validateText,
  validateUuid,
} from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    const body = await req.json()
    const vl = validateUuid(body.leadId, "leadId")
    if (!vl.ok) return vl.response
    const vn = validateText(body.notes, {
      required: false,
      maxLen: INPUT_MAX.long,
      field: "notes",
    })
    if (!vn.ok) return vn.response

    const { error } = await supabase
      .from("leads")
      .update({ internal_notes: vn.value })
      .eq("id", vl.value)

    if (error) {
      console.error("Notes save error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Save notes error:", error)
    const message = error instanceof Error ? error.message : "Save failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
