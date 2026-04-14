import { NextResponse } from "next/server"
import {
  INPUT_MAX,
  validateText,
} from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { geocodeAddressToTarget } from "@/lib/location-targeting"
import { extractLocationForGeocoding } from "@/lib/search-query-location"
import { rateLimitResponse } from "@/lib/rateLimit"

const FETCH_TIMEOUT_MS = 20000

async function safeFetch(url: string, options: RequestInit = {}): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res?.ok) return null
    return res
  } catch {
    return null
  }
}

async function safeJson<T>(res: Response | null): Promise<T | null> {
  if (!res) return null
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Geocode the location portion of a campaign search query (server-side, API key not exposed).
 * Safe to fail — client omits lat/lng on insert if this returns ok: false.
 */
export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "geocode-campaign-location")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    const body = (await req.json()) as { search_query?: string }
    const v = validateText(body.search_query, {
      required: true,
      maxLen: INPUT_MAX.long,
      field: "search_query",
    })
    if (!v.ok) return v.response
    const search_query = v.value

    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return NextResponse.json({ ok: false, reason: "no_api_key" }, { status: 200 })
    }

    const address = extractLocationForGeocoding(search_query)
    const target = await geocodeAddressToTarget(address, apiKey, safeFetch, safeJson)
    if (!target) {
      return NextResponse.json({ ok: false, reason: "geocode_failed" }, { status: 200 })
    }

    console.log(`Geocoded city → ${target.lat},${target.lng}`)
    return NextResponse.json({
      ok: true,
      lat: target.lat,
      lng: target.lng,
      label: target.label,
    })
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 200 })
  }
}
