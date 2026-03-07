import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: Request) {
  try {
    const { leadId, notes } = await req.json()
    if (!leadId) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 })
    }

    const { error } = await supabase
      .from("leads")
      .update({ internal_notes: notes ?? "" })
      .eq("id", leadId)

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
