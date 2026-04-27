/**
 * Per connected Gmail mailbox: max sends in a rolling 24h window.
 * This guards Gmail / deliverability (not your Supabase or Vercel bill).
 *
 * Configure with `MAILBOX_ROLLING_SEND_CAP` (number) or disable with
 * `MAILBOX_ROLLING_SEND_CAP=0` / `DISABLE_MAILBOX_SEND_CAP=1`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/** Default cap when env is unset. */
export const DEFAULT_MAILBOX_ROLLING_SEND_CAP = 200

/** @deprecated use DEFAULT_MAILBOX_ROLLING_SEND_CAP */
export const DAILY_MAILBOX_SEND_CAP = DEFAULT_MAILBOX_ROLLING_SEND_CAP

/**
 * Effective rolling cap per mailbox, or `null` = unlimited (checks skipped).
 */
export function getEffectiveMailboxRollingSendCap(): number | null {
  if (
    process.env.DISABLE_MAILBOX_SEND_CAP === "1" ||
    process.env.DISABLE_MAILBOX_SEND_CAP?.toLowerCase() === "true"
  ) {
    return null
  }
  const raw = process.env.MAILBOX_ROLLING_SEND_CAP?.trim()
  if (!raw) return DEFAULT_MAILBOX_ROLLING_SEND_CAP
  const lower = raw.toLowerCase()
  if (lower === "unlimited" || lower === "none" || raw === "0") return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAILBOX_ROLLING_SEND_CAP
  if (n === 0) return null
  return Math.min(n, 50_000)
}

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000

export function mailboxSendCountSinceIso(): string {
  return new Date(Date.now() - ROLLING_WINDOW_MS).toISOString()
}

export async function getMailboxEmailForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("gmail_email, connected")
    .eq("user_id", userId)
    .maybeSingle()

  if (error || !data?.gmail_email || data.connected !== true) {
    return null
  }

  return String(data.gmail_email).trim().toLowerCase() || null
}

/** Rolling 24h send count for this mailbox (campaign_messages). */
export async function countMailboxSendsRolling24h(
  supabase: SupabaseClient,
  senderEmail: string
): Promise<number> {
  const normalized = senderEmail.trim().toLowerCase()
  if (!normalized) return 0

  const { count, error } = await supabase
    .from("campaign_messages")
    .select("id", { count: "exact", head: true })
    .eq("sender_email", normalized)
    .eq("status", "sent")
    .gte("sent_at", mailboxSendCountSinceIso())

  if (error) {
    console.error(
      "[mailbox-daily-send-cap] count query failed — not blocking sends (fail-open). Fix DB/cache if this persists:",
      error
    )
    /** Never treat a failed analytics query as “at cap” or every send is blocked (common after deploy / schema drift). */
    return 0
  }

  return count ?? 0
}

export async function isMailboxAtDailySendCap(
  supabase: SupabaseClient,
  senderEmail: string | null
): Promise<boolean> {
  const cap = getEffectiveMailboxRollingSendCap()
  if (cap === null || !senderEmail) return false
  const n = await countMailboxSendsRolling24h(supabase, senderEmail)
  return n >= cap
}
