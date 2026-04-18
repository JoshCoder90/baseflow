import OpenAI from "openai"

/** Parse natural language search into niche + location for Google Places */
export async function parseSearchQuery(
  query: string
): Promise<{ niche: string; location: string }> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    const match = query.match(/^(.+?)\s+in\s+(.+)$/i)
    if (match) {
      return { niche: match[1].trim(), location: match[2].trim() }
    }
    return { niche: query.trim(), location: "United States" }
  }
  const openai = new OpenAI({ apiKey: openaiKey })
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extract business type (niche) and location from the user's search query.
Examples:
- "Dental offices in New York" -> niche: "dental offices", location: "New York"
- "Roofing companies in Dallas" -> niche: "roofing companies", location: "Dallas"
- "Real estate agents in Miami" -> niche: "real estate agents", location: "Miami"
- "Gyms in Los Angeles" -> niche: "gyms", location: "Los Angeles"
- "Marketing agencies in Austin" -> niche: "marketing agencies", location: "Austin"
Return JSON: { "niche": "...", "location": "..." }
If no location is given, use "United States".`,
      },
      { role: "user", content: query },
    ],
    response_format: { type: "json_object" },
  })
  const text = res.choices[0]?.message?.content ?? "{}"
  const parsed = JSON.parse(text) as { niche?: string; location?: string }
  return {
    niche: parsed.niche?.trim() || query.trim(),
    location: parsed.location?.trim() || "United States",
  }
}
