import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json()) as {
      name?: string
      target_search_query?: string
      message_template?: string
      subject?: string
      location_lat?: number
      location_lng?: number
    }

    const trimmedQuery = (body.target_search_query ?? "").trim()
    const trimmedMessage = (body.message_template ?? "").trim()
    if (!trimmedQuery || !trimmedMessage) {
      return NextResponse.json(
        { error: "target_search_query and message_template are required" },
        { status: 400 }
      )
    }

    const trimmedName = (body.name ?? "").trim()
    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      name: trimmedName || "Untitled campaign",
      target_search_query: trimmedQuery,
      message_template: trimmedMessage,
      subject: (body.subject ?? "").trim() || "Quick question",
      status: "draft",
      channel: OUTBOUND_EMAIL_CHANNEL,
      lead_generation_status: "generating",
      lead_generation_stage: "searching",
    }

    if (
      typeof body.location_lat === "number" &&
      typeof body.location_lng === "number" &&
      !Number.isNaN(body.location_lat) &&
      !Number.isNaN(body.location_lng)
    ) {
      insertPayload.location_lat = body.location_lat
      insertPayload.location_lng = body.location_lng
    }

    const { data, error } = await supabase
      .from("campaigns")
      .insert(insertPayload)
      .select()
      .single()

    if (error) {
      console.error("create-campaign insert:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ campaign: data })
  } catch (e) {
    console.error("create-campaign:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create campaign" },
      { status: 500 }
    )
  }
}
