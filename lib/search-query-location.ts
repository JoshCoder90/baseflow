/**
 * Best-effort location string for Geocoding from a natural-language campaign search.
 * e.g. "Landscapers in Phoenix, AZ" → "Phoenix, AZ"
 */
export function extractLocationForGeocoding(searchQuery: string): string {
  const q = searchQuery.trim()
  if (!q) return q
  const m = q.match(/\s+in\s+(.+)$/i)
  if (m) return m[1].trim()
  return q
}
