/**
 * Geocode-driven targeting for lead scraping: anchor searches on coordinates,
 * then filter Places results by distance from the campaign center (+ foreign-address hints).
 */

export type GeocodedTarget = {
  lat: number
  lng: number
  /** Human label geocoded (e.g. "Phoenix, AZ") */
  label: string
  locality?: string
  admin1?: string
  admin1Short?: string
  country?: string
  countryShort?: string
  bounds?: {
    northeast: { lat: number; lng: number }
    southwest: { lat: number; lng: number }
  }
  viewport?: {
    northeast: { lat: number; lng: number }
    southwest: { lat: number; lng: number }
  }
}

export type GeocodeComponent = {
  long_name: string
  short_name: string
  types: string[]
}

export type GeocodeGeometry = {
  location: { lat: number; lng: number }
  bounds?: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } }
  viewport?: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } }
}

function pickComponent(
  components: GeocodeComponent[] | undefined,
  ...types: string[]
): GeocodeComponent | undefined {
  if (!components) return undefined
  for (const t of types) {
    const c = components.find((x) => x.types.includes(t))
    if (c) return c
  }
  return undefined
}

export function parseGeocodeResult(
  label: string,
  result: {
    geometry?: GeocodeGeometry
    address_components?: GeocodeComponent[]
  } | null
): GeocodedTarget | null {
  const loc = result?.geometry?.location
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null

  const comps = result?.address_components
  const locality =
    pickComponent(comps, "locality", "sublocality", "sublocality_level_1")?.long_name
  const admin1 = pickComponent(comps, "administrative_area_level_1")?.long_name
  const admin1Short = pickComponent(comps, "administrative_area_level_1")?.short_name
  const country = pickComponent(comps, "country")?.long_name
  const countryShort = pickComponent(comps, "country")?.short_name

  return {
    lat: loc.lat,
    lng: loc.lng,
    label,
    locality,
    admin1,
    admin1Short,
    country,
    countryShort,
    bounds: result?.geometry?.bounds,
    viewport: result?.geometry?.viewport,
  }
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/** Obvious non-US / foreign business locations (reject when address clearly names another country/region). */
const FOREIGN_COUNTRY_HINTS =
  /\b(europe|united kingdom|england|scotland|wales|canada|australia|france|germany|deutschland|spain|italy|india|china|japan|brazil|netherlands|belgium|ireland|sweden|norway|denmark|finland|poland|austria|switzerland|portugal|greece|new zealand)\b/i

export type NearbyPlaceLike = {
  name?: string
  vicinity?: string
  formatted_address?: string
  geometry?: { location: { lat: number; lng: number } }
}

/**
 * Max distance from the **campaign geocode center** (not the active search anchor).
 * ~65km: broad metro + multi-keyword coverage without exact city match.
 */
const METRO_RADIUS_FROM_CAMPAIGN_CENTER_M = 65_000

/**
 * Reject Places hits outside the campaign metro (distance from target center) or obvious foreign addresses.
 * Does not require matching the city name (e.g. "Phoenix") — only distance + foreign hints.
 */
export function isNearbyPlaceInTargetRegion(
  place: NearbyPlaceLike,
  _searchCenter: { lat: number; lng: number },
  _searchRadiusM: number,
  target: GeocodedTarget
): boolean {
  const name = place.name?.trim() || "(unknown)"
  const loc = place.geometry?.location
  if (!loc) {
    console.log(`Filtered out non-local result: ${name} (no geometry)`)
    return false
  }

  const dFromCampaign = haversineMeters(loc, { lat: target.lat, lng: target.lng })
  const kmFromCampaign = dFromCampaign / 1000
  const distance = kmFromCampaign
  if (!distance || Number.isNaN(distance)) {
    console.log("[SAFE] skipping distance filter")
  } else if (distance > 500) {
    console.log(`Rejected: too far (${kmFromCampaign.toFixed(1)} km) — ${name}`)
    return false
  }

  const addrCombined = `${place.vicinity || ""} ${place.formatted_address || ""}`
  const hay = addrCombined.toLowerCase()
  if (FOREIGN_COUNTRY_HINTS.test(hay)) {
    console.log(`Filtered out non-local result: ${name} (foreign address hint)`)
    return false
  }

  return true
}

type GeocodeApiResult = {
  results?: Array<{
    formatted_address?: string
    geometry?: GeocodeGeometry
    address_components?: GeocodeComponent[]
  }>
  error_message?: string
}

/**
 * Forward-geocode a free-text location to coordinates + admin components (Google Geocoding API).
 */
export async function geocodeAddressToTarget(
  address: string,
  apiKey: string,
  safeFetch: (url: string, options?: RequestInit) => Promise<Response | null>,
  safeJson: <T>(res: Response | null) => Promise<T | null>
): Promise<GeocodedTarget | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
  const res = await safeFetch(url)
  const data = await safeJson<GeocodeApiResult>(res)
  if (data?.error_message) {
    console.error("Geocoding API error:", data.error_message)
    return null
  }
  const first = data?.results?.[0]
  if (!first) return null
  const label = first.formatted_address?.trim() || address.trim() || address
  return parseGeocodeResult(label, first)
}

/**
 * Reverse-geocode coordinates to fill region bounds/components (for DB-stored lat/lng).
 */
export async function reverseGeocodeToTarget(
  lat: number,
  lng: number,
  fallbackLabel: string,
  apiKey: string,
  safeFetch: (url: string, options?: RequestInit) => Promise<Response | null>,
  safeJson: <T>(res: Response | null) => Promise<T | null>
): Promise<GeocodedTarget | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${apiKey}`
  const res = await safeFetch(url)
  const data = await safeJson<GeocodeApiResult>(res)
  if (data?.error_message) {
    console.error("Reverse geocoding API error:", data.error_message)
    return null
  }
  const first = data?.results?.[0]
  if (!first?.geometry?.location) return null
  const label = first.formatted_address?.trim() || fallbackLabel
  return parseGeocodeResult(label, first)
}
