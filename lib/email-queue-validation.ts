/**
 * Synchronous rules for whether an address may be queued in campaign_messages.
 * Must match send-time strict filter; DNS is checked only at send (see email-send-filter).
 */

/** Typical business address: ASCII local part, single @, domain with labels + TLD. */
export const CAMPAIGN_EMAIL_FORMAT_RE =
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

const MAX_TOTAL_LEN = 90
const MAX_LOCAL_LEN = 48

/**
 * Long single-token local parts (e.g. scraped hashes / IDs) — real business mailboxes
 * usually use short locals or dotted names.
 */
const HASH_LIKE_LOCAL_MIN = 20
const HASH_LIKE_LOCAL = /^[a-zA-Z0-9]+$/ // no dot, looks like a random blob

/**
 * Returns true only if this email may be inserted into campaign_messages.
 */
export function isEmailAllowedForCampaignQueue(email: string): boolean {
  const t = email.trim()
  if (!t) return false
  if (t.length > MAX_TOTAL_LEN || t.length > 254) return false

  const lower = t.toLowerCase()
  if (lower === "user@domain.com") return false
  if (lower.includes("user@domain")) return false
  if (lower.includes("domain.com")) return false
  if (lower.includes("example.com")) return false
  if (lower.includes("example")) return false
  if (lower.includes("test")) return false
  if (lower.includes("noreply")) return false
  if (lower.includes("sentry")) return false
  if (lower.includes("wixpress")) return false

  const at = t.lastIndexOf("@")
  if (at <= 0 || at >= t.length - 1) return false
  const local = t.slice(0, at)
  if (!local || local.length > MAX_LOCAL_LEN) return false

  if (local.length >= HASH_LIKE_LOCAL_MIN && HASH_LIKE_LOCAL.test(local)) {
    return false
  }

  if (!CAMPAIGN_EMAIL_FORMAT_RE.test(t)) return false
  return true
}
