/**
 * Strict recipient checks immediately before send (not used during scraping).
 * Same sync rules as queue (isEmailAllowedForCampaignQueue); DNS runs after this passes.
 */

import { validateRecipientEmailForSending } from "@/lib/email-domain-validation"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"

export function passesStrictEmailFilter(email: string): boolean {
  return isEmailAllowedForCampaignQueue(email)
}

export type RecipientSendResult =
  | { ok: true }
  | { ok: false; reason: "filtered" }
  | { ok: false; reason: "dns" }

/**
 * Full pre-send validation: format/content rules (must include @ and ., blocked substrings)
 * plus a simple DNS check (MX or A/AAAA).
 */
export async function isValidEmail(
  email: string | null | undefined
): Promise<RecipientSendResult> {
  if (email == null || typeof email !== "string") {
    return { ok: false, reason: "filtered" }
  }
  const t = email.trim()
  if (!t) return { ok: false, reason: "filtered" }
  if (!passesStrictEmailFilter(t)) {
    return { ok: false, reason: "filtered" }
  }
  const dns = await validateRecipientEmailForSending(t)
  if (!dns.ok) return { ok: false, reason: "dns" }
  return { ok: true }
}

export async function validateRecipientForSend(
  email: string | null | undefined
): Promise<RecipientSendResult> {
  return isValidEmail(email)
}
