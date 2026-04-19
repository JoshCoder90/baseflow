/**
 * Per-subsystem sliding-window limits (separate buckets; not one global API cap).
 * Keys are explicit, e.g. `bf:scrape_start:<userId>` vs `bf:ai_reply:<userId>`.
 */

const buckets = new Map<string, number[]>()

export function consumeRateLimit(
  bucketKey: string,
  maxInWindow: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const start = now - windowMs
  const prev = (buckets.get(bucketKey) ?? []).filter((t) => t > start)
  prev.push(now)
  buckets.set(bucketKey, prev)
  return prev.length <= maxInWindow
}

/** @internal testing */
export function __resetRateLimitBucketsForTests(): void {
  buckets.clear()
}

const activeScrapeByUserId = new Set<string>()

export function tryBeginScrapeForUser(userId: string): boolean {
  if (activeScrapeByUserId.has(userId)) return false
  activeScrapeByUserId.add(userId)
  return true
}

export function endScrapeForUser(userId: string): void {
  activeScrapeByUserId.delete(userId)
}

/** @internal testing */
export function __resetActiveScrapesForTests(): void {
  activeScrapeByUserId.clear()
}

export const RATE_LIMIT = {
  /** Scrape POST /api/scrape-batch — starts only (legacy generate-leads disabled) */
  scrapeStartPerUserPerMinute: 3,
  /** Inbox AI suggestions — POST /api/generate-reply */
  aiReplyPerUserPerMinute: 15,
  /** Manual Gmail sync — GET/POST /api/sync-gmail-replies (not internal loop) */
  gmailSyncManualPerUserPerMinute: 5,
  /** Fallback when sync is called without session (should be rare) */
  gmailSyncUnauthenticatedPerIpPerMinute: 60,
} as const

export const SCRAPE_POLICY = {
  maxLeadsPerScrape: 200,
} as const

export function tooManyRequestsJson(
  message: string,
  status = 429
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
