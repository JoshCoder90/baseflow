import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const input = searchParams.get("input")?.trim()

  if (!input || input.length < 1) {
    return NextResponse.json({ predictions: [] })
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ predictions: [] })
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json")
  url.searchParams.set("input", input)
  url.searchParams.set("key", apiKey)
  url.searchParams.set("types", "establishment")

  try {
    const res = await fetch(url.toString())
    const data = await res.json()

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Places business search error:", data.status, data.error_message)
      return NextResponse.json({ predictions: [] })
    }

    const predictions = (data.predictions ?? []).map(
      (p: { place_id: string; description: string; structured_formatting?: { main_text: string; secondary_text?: string } }) => ({
        place_id: p.place_id,
        description: p.description,
        main_text: (p.structured_formatting?.main_text ?? p.description.split(",")[0]?.trim()) ?? p.description,
        secondary_text: (p.structured_formatting?.secondary_text ?? p.description.split(",").slice(1).join(",").trim()) || "",
      })
    )

    return NextResponse.json({ predictions })
  } catch (err) {
    console.error("Places business search fetch error:", err)
    return NextResponse.json({ predictions: [] })
  }
}
