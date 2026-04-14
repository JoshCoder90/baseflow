export function isValidEmail(email: string): boolean {
  if (!email) return false

  return (
    email.includes("@") &&
    email.includes(".") &&
    !email.includes("example") &&
    !email.includes("test") &&
    !email.includes("domain.com")
  )
}

/** Preserves the previous async API for callers; no DNS (Edge-safe). */
export async function validateRecipientEmailForSending(
  email: string
): Promise<{ ok: true } | { ok: false }> {
  return isValidEmail(email) ? { ok: true } : { ok: false }
}
