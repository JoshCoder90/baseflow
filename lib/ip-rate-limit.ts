import { consumeRateLimit, tooManyRequestsJson } from "@/lib/rate-limit-policy"

/** Shared budget for “heavy” HTTP handlers: per route key, per client IP. */
export const HEAVY_ROUTE_IP = {
  maxPerWindow: 10,
  windowMs: 10_000,
} as const

/** Queue tab polls `send-email-now`; keep separate from HEAVY_ROUTE_IP so bursts + 30s retries do not hit 429. */
export const QUEUE_SEND_ROUTE_IP = {
  maxPerWindow: 180,
  windowMs: 60_000,
} as const

export function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for")
  if (xf) {
    const first = xf.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const cf = req.headers.get("cf-connecting-ip")?.trim()
  if (cf) return cf
  return "unknown"
}

/**
 * Returns a 429 Response if this IP exceeded the limit for this route key.
 * Otherwise returns null (caller continues).
 */
export function heavyRouteIpLimitResponse(
  req: Request,
  routeKey: string
): Response | null {
  const ip = getClientIp(req)
  const key = `bf:heavy_ip:${routeKey}:${ip}`
  const ok = consumeRateLimit(
    key,
    HEAVY_ROUTE_IP.maxPerWindow,
    HEAVY_ROUTE_IP.windowMs
  )
  if (ok) return null
  return tooManyRequestsJson("Too many requests", 429)
}

export function queueSendRouteIpLimitResponse(req: Request): Response | null {
  const ip = getClientIp(req)
  const key = `bf:queue_send_ip:${ip}`
  const ok = consumeRateLimit(
    key,
    QUEUE_SEND_ROUTE_IP.maxPerWindow,
    QUEUE_SEND_ROUTE_IP.windowMs
  )
  if (ok) return null
  return tooManyRequestsJson("Too many requests", 429)
}
