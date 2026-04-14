/**
 * Fast synchronous filter before inserting into campaign_messages (and similar paths).
 * Stricter checks (DNS, etc.) run at send time in email-send-filter.
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false

  const lower = email.toLowerCase()

  return (
    lower.includes("@") &&
    lower.includes(".") &&
    !lower.includes("example") &&
    !lower.includes("test") &&
    !lower.includes("domain.com") &&
    !lower.includes("email.com") &&
    !lower.startsWith("user@") &&
    !lower.startsWith("test@") &&
    !lower.includes("noreply")
  )
}
