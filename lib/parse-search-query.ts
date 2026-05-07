import OpenAI from "openai"

/** Fast path when the query already separates niche and place (no LLM). */
function tryParseSearchQueryHeuristic(query: string): { niche: string; location: string } | null {
  const q = query.trim()
  if (q.length < 3) return null

  const inMatch = q.match(/^(.+?)\s+in\s+(.+)$/i)
  if (inMatch) {
    const niche = inMatch[1].trim()
    const location = inMatch[2].trim()
    if (niche.length >= 2 && location.length >= 2) return { niche, location }
  }

  const nearMatch = q.match(/^(.+?)\s+near\s+(.+)$/i)
  if (nearMatch) {
    const niche = nearMatch[1].trim()
    const location = nearMatch[2].trim()
    if (niche.length >= 2 && location.length >= 2) return { niche, location }
  }

  return null
}

/** Parse natural language search into niche + location for Google Places */
export async function parseSearchQuery(
  query: string
): Promise<{ niche: string; location: string }> {
  const heuristic = tryParseSearchQueryHeuristic(query)
  if (heuristic) return heuristic

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
