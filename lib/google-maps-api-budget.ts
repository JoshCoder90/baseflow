/**
 * Hard ceiling on Google Maps / Places / Geocoding HTTP calls per full campaign scrape
 * (checkpointed — includes list + geocode + detail calls).
 * ~128 was stopping many runs at ~100–120 leads. 240 targets 200 lead cap with headroom for
 * pagination; adjust with your Google bill and typical city density.
 */
export const MAX_GOOGLE_MAPS_API_CALLS_PER_CAMPAIGN_SCRAPE = 240

/** @returns false when at/over max (slot not consumed). Otherwise increments ref and returns true. */
export function consumeGoogleMapsApiSlot(ref: { current: number }, max: number): boolean {
  if (ref.current >= max) {
    console.log("[HARD STOP] API LIMIT HIT")
    return false
  }
  ref.current++
  return true
}

/**
 * Wraps an async Maps/Places call: consumes one slot, then runs fn.
 * Returns null at/over max without calling fn.
 */
export function safeGoogleCall<A extends unknown[], R>(
  ref: { current: number },
  max: number,
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R | null> {
  return async (...args) => {
    if (!consumeGoogleMapsApiSlot(ref, max)) return null
    return await fn(...args)
  }
}
