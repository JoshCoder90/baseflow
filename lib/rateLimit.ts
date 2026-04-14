/**
 * Legacy helper: previously applied one shared per-IP limit to every route that imported it,
 * which stacked unrelated endpoints into a single bucket. That is disabled — use
 * `lib/rate-limit-policy.ts` (or subsystem-specific checks) instead.
 */
export function rateLimitResponse(_req: Request): Response | null {
  return null
}

/** @deprecated Prefer consumeRateLimit from @/lib/rate-limit-policy with an explicit bucket key. */
export function rateLimit(_key: string, _limit = 60, _windowMs = 60000): void {
  /* no-op */
}
