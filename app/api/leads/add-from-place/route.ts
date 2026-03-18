import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { audience_id: audienceId, place_id: placeId, email } = body

  if (!audienceId || !placeId) {
    return NextResponse.json(
      { error: "audience_id and place_id are required" },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify audience belongs to user and check target limit
  const { data: audience, error: audienceError } = await supabase
    .from("audiences")
    .select("id, user_id, target_leads")
    .eq("id", audienceId)
    .single()

  if (audienceError || !audience || audience.user_id !== user.id) {
    return NextResponse.json({ error: "Audience not found" }, { status: 404 })
  }

  const targetLeads = audience.target_leads ?? 200
  const { count: currentCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("audience_id", audienceId)

  if ((currentCount ?? 0) >= targetLeads) {
    return NextResponse.json(
      {
        error: `Audience has reached the target lead limit of ${targetLeads} leads.`,
      },
      { status: 400 }
    )
  }

  // Check duplicate: place_id + audience_id (unique constraint)
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("audience_id", audienceId)
    .eq("place_id", placeId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: "This lead already exists in this audience." },
      { status: 409 }
    )
  }

  // Fetch Place Details
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 }
    )
  }

  const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json")
  detailsUrl.searchParams.set("place_id", placeId)
  detailsUrl.searchParams.set("key", apiKey)
  detailsUrl.searchParams.set(
    "fields",
    "name,formatted_address,formatted_phone_number,website,rating"
  )

  const detailsRes = await fetch(detailsUrl.toString())
  const detailsData = await detailsRes.json()

  if (detailsData.status !== "OK") {
    return NextResponse.json(
      { error: "Could not fetch business details" },
      { status: 400 }
    )
  }

  const r = detailsData.result

  const { data: newLead, error: insertError } = await supabase
    .from("leads")
    .insert({
      audience_id: audienceId,
      user_id: user.id,
      name: r?.name ?? null,
      address: r?.formatted_address ?? null,
      phone: r?.formatted_phone_number ?? null,
      email: email?.trim() || null,
      website: r?.website ?? null,
      google_rating: r?.rating ?? null,
      status: "new",
      place_id: placeId,
    })
    .select("id, name, address, phone, website, google_rating, status")
    .single()

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "This lead already exists in this audience." },
        { status: 409 }
      )
    }
    console.error("Insert lead error:", insertError)
    return NextResponse.json(
      { error: insertError.message ?? "Failed to add lead" },
      { status: 500 }
    )
  }

  // Update audiences.leads_collected
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
    lead: newLead,
  })
}
