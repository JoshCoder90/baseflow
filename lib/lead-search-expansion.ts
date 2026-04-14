/**
 * Extra geocode / Places search centers beyond the primary "city + directional" variants.
 * Improves coverage for large metros so scraping can reach valid lead targets.
 */

export function mergeSearchAreaStringLists(...groups: string[][]): string[] {
  return dedupeStrings(groups.flat())
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Boroughs / sub-regions keyed by normalized phrases in the parsed location string. */
const SUB_REGIONS: { match: (loc: string) => boolean; areas: string[] }[] = [
  {
    match: (loc) => {
      if (/\bnew york state\b/.test(loc)) return false
      if (
        /\b(rochester|buffalo|albany|syracuse|utica|ithaca|binghamton|saratoga springs)\b/.test(loc)
      ) {
        return false
      }
      return (
        /\bnew york city\b/.test(loc) ||
        /\bnyc\b/.test(loc) ||
        /\bbrooklyn\b/.test(loc) ||
        /\bqueens\b/.test(loc) ||
        /\bmanhattan\b/.test(loc) ||
        /\bbronx\b/.test(loc) ||
        /\bstaten island\b/.test(loc) ||
        (/\bnew york\b/.test(loc) && !/\bstate\b/.test(loc))
      )
    },
    areas: [
      "Brooklyn, New York",
      "Queens, New York",
      "Manhattan, New York",
      "Bronx, New York",
      "Staten Island, New York",
      "Long Island, New York",
      "Jersey City, New Jersey",
      "Newark, New Jersey",
    ],
  },
  {
    match: (loc) =>
      /\blos angeles\b/.test(loc) ||
      /\bla county\b/.test(loc) ||
      /\bhollywood\b/.test(loc),
    areas: [
      "Long Beach, California",
      "Santa Monica, California",
      "Pasadena, California",
      "Glendale, California",
      "Torrance, California",
      "Burbank, California",
      "Anaheim, California",
      "Irvine, California",
    ],
  },
  {
    match: (loc) => /\bchicago\b/.test(loc),
    areas: [
      "Evanston, Illinois",
      "Oak Park, Illinois",
      "Cicero, Illinois",
      "Skokie, Illinois",
      "Naperville, Illinois",
      "Schaumburg, Illinois",
    ],
  },
  {
    match: (loc) => /\bhouston\b/.test(loc),
    areas: [
      "Sugar Land, Texas",
      "The Woodlands, Texas",
      "Pearland, Texas",
      "Katy, Texas",
      "Pasadena, Texas",
    ],
  },
  {
    match: (loc) => /\bdallas\b/.test(loc) || /\bfort worth\b/.test(loc) || /\bdfw\b/.test(loc),
    areas: [
      "Fort Worth, Texas",
      "Arlington, Texas",
      "Plano, Texas",
      "Irving, Texas",
      "Garland, Texas",
      "Frisco, Texas",
    ],
  },
  {
    match: (loc) => /\bmiami\b/.test(loc) || /\bfort lauderdale\b/.test(loc),
    areas: [
      "Fort Lauderdale, Florida",
      "Hialeah, Florida",
      "Boca Raton, Florida",
      "West Palm Beach, Florida",
      "Coral Springs, Florida",
    ],
  },
  {
    match: (loc) => /\bphoenix\b/.test(loc),
    areas: [
      "Scottsdale, Arizona",
      "Mesa, Arizona",
      "Chandler, Arizona",
      "Glendale, Arizona",
      "Tempe, Arizona",
    ],
  },
  {
    match: (loc) => /\bphiladelphia\b/.test(loc),
    areas: [
      "Camden, New Jersey",
      "Chester, Pennsylvania",
      "Wilmington, Delaware",
      "King of Prussia, Pennsylvania",
    ],
  },
  {
    match: (loc) => /\bsan francisco\b/.test(loc) || /\bsf\b/.test(loc),
    areas: [
      "Oakland, California",
      "San Jose, California",
      "Berkeley, California",
      "Fremont, California",
      "Palo Alto, California",
    ],
  },
  {
    match: (loc) => /\bseattle\b/.test(loc),
    areas: [
      "Bellevue, Washington",
      "Tacoma, Washington",
      "Everett, Washington",
      "Renton, Washington",
    ],
  },
  {
    match: (loc) => /\bdenver\b/.test(loc),
    areas: [
      "Aurora, Colorado",
      "Lakewood, Colorado",
      "Boulder, Colorado",
      "Thornton, Colorado",
    ],
  },
  {
    match: (loc) => /\blondon\b/.test(loc),
    areas: [
      "Westminster, London, UK",
      "Camden, London, UK",
      "Greenwich, London, UK",
      "Croydon, London, UK",
      "Ealing, London, UK",
    ],
  },
]

/** Generic extra anchors: suburbs / metro wording (deduped against primary). */
function genericMetroVariants(primaryLocation: string): string[] {
  const p = primaryLocation.trim()
  if (!p) return []
  return [
    `${p} metropolitan area`,
    `${p} metro area`,
    `suburbs of ${p}`,
    `${p} suburbs`,
  ]
}

export function getStaticExpandedAreaStrings(primaryLocation: string): string[] {
  const loc = norm(primaryLocation)
  const extra: string[] = []
  for (const { match, areas } of SUB_REGIONS) {
    if (match(loc)) extra.push(...areas)
  }
  extra.push(...genericMetroVariants(primaryLocation))
  return dedupeStrings(extra)
}

export function buildPrimarySearchAreaStrings(location: string): string[] {
  const p = location.trim()
  if (!p) return []
  return dedupeStrings([
    p,
    `near ${p}`,
    `${p} downtown`,
    `${p} center`,
    `north ${p}`,
    `south ${p}`,
    `east ${p}`,
    `west ${p}`,
  ])
}

/**
 * Full list of geocode query strings: primary directional variants + metro-specific expansion.
 */
export function buildAllSearchAreaStrings(location: string): string[] {
  return dedupeStrings([...buildPrimarySearchAreaStrings(location), ...getStaticExpandedAreaStrings(location)])
}

/** Optional: LLM-suggested nearby search areas (JSON array of strings). */
/** When OpenAI is unavailable, map niche text to extra Places `keyword` terms (no location). */
const NICHE_KEYWORD_FALLBACKS: { test: RegExp; extras: string[] }[] = [
  {
    test: /landscap|lawn|yard|tree|irrigation|outdoor|hardscap/i,
    extras: [
      "landscaping",
      "lawn care",
      "yard maintenance",
      "tree service",
      "landscape company",
      "outdoor services",
    ],
  },
  {
    test: /dental|dentist|orthodont/i,
    extras: ["dentist", "dental office", "dental clinic", "family dentist", "dental care"],
  },
  {
    test: /roof|gutter/i,
    extras: ["roofing", "roof repair", "roofing contractor", "gutters"],
  },
  {
    test: /real\s*estate|realtor|property/i,
    extras: ["real estate agent", "realtor", "real estate", "property management"],
  },
  {
    test: /gym|fitness|personal\s*train/i,
    extras: ["gym", "fitness center", "personal training", "fitness"],
  },
  {
    test: /plumb|hvac|electric/i,
    extras: ["plumber", "plumbing", "HVAC", "electrician", "electrical contractor"],
  },
  {
    test: /market|agency|seo|web\s*design/i,
    extras: ["marketing agency", "digital marketing", "web design", "advertising agency"],
  },
]

export function getNicheFallbackKeywordVariants(niche: string): string[] {
  const n = norm(niche)
  const out: string[] = []
  for (const { test, extras } of NICHE_KEYWORD_FALLBACKS) {
    if (test.test(n)) out.push(...extras)
  }
  return dedupeStrings(out)
}

/**
 * LLM-generated Google Places Nearby Search keyword phrases (no city/location).
 */
export async function expandKeywordsWithAI(niche: string): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return []

  const OpenAI = (await import("openai")).default
  const openai = new OpenAI({ apiKey: openaiKey })
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You generate short Google Places Nearby Search "keyword" terms. No city, state, or "in ...".
Return JSON: { "keywords": string[] } with 6 to 12 distinct English phrases.
Each 1-4 words: business types and close synonyms only (e.g. "landscaping", "lawn care", "family dentist").
No duplicates.`,
        },
        { role: "user", content: `Business niche: "${niche.trim()}"` },
      ],
      response_format: { type: "json_object" },
    })
    const text = res.choices[0]?.message?.content ?? "{}"
    const parsed = JSON.parse(text) as { keywords?: unknown }
    const arr = Array.isArray(parsed.keywords) ? parsed.keywords : []
    return dedupeStrings(
      arr.filter((a): a is string => typeof a === "string" && a.trim().length > 1).map((a) => a.trim())
    )
  } catch {
    return []
  }
}

/** Ordered unique keywords for Places Nearby: niche first, then AI + pattern fallbacks. */
export async function buildPlacesKeywordVariants(niche: string): Promise<string[]> {
  const trimmed = niche.trim()
  if (!trimmed) return []
  const ai = await expandKeywordsWithAI(trimmed)
  const pattern = getNicheFallbackKeywordVariants(trimmed)
  return dedupeStrings([trimmed, ...ai, ...pattern])
}

export async function expandLocationsWithAI(
  location: string,
  niche: string
): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return []

  const OpenAI = (await import("openai")).default
  const openai = new OpenAI({ apiKey: openaiKey })
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You help B2B lead generation find nearby cities, boroughs, counties, or neighborhoods to search for businesses.
Return a JSON object: { "areas": string[] } with 8 to 14 distinct place names suitable for Google Geocoding.
Each string should be a specific locality (e.g. "Plano, Texas" or "Brooklyn, New York"), not duplicate the main city.
Prefer suburbs, adjacent cities, and boroughs. No explanations.`,
        },
        {
          role: "user",
          content: `Main location: "${location}". Business type / niche: "${niche}".`,
        },
      ],
      response_format: { type: "json_object" },
    })
    const text = res.choices[0]?.message?.content ?? "{}"
    const parsed = JSON.parse(text) as { areas?: unknown }
    const arr = Array.isArray(parsed.areas) ? parsed.areas : []
    return dedupeStrings(
      arr.filter((a): a is string => typeof a === "string" && a.trim().length > 2).map((a) => a.trim())
    )
  } catch {
    return []
  }
}
