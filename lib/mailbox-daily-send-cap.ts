/**
 * Per connected Gmail mailbox: max sends in a rolling 24h window.
 * This guards Gmail / deliverability (not your Supabase or Vercel bill).
 *
 * Configure with `MAILBOX_ROLLING_SEND_CAP` (number) or disable with
 * `MAILBOX_ROLLING_SEND_CAP=0` / `DISABLE_MAILBOX_SEND_CAP=1`.
 *
 * Rolling counts use **all `campaign_messages` marked sent** for this user's campaigns
 * in the last 24h (no `sender_email` filter). That avoids PostgREST errors when
 * `sender_email` is missing from the schema cache or unused on historical rows.
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

const CAMPAIGN_ID_CHUNK = 200

/**
 * Rolling 24h count of sends for this **user** (via their campaigns). Approximates
 * per-mailbox volume when one Gmail account is connected.
 */
export async function countMailboxSendsRolling24h(
  supabase: SupabaseClient,
  ownerUserId: string
): Promise<number> {
  const since = mailboxSendCountSinceIso()

  const { data: campaigns, error: cErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("user_id", ownerUserId)

  if (cErr) {
    console.warn("[mailbox-daily-send-cap] campaigns query:", cErr.message ?? cErr)
    return 0
  }

  const ids = (campaigns ?? []).map((r) => r.id as string).filter(Boolean)
  if (ids.length === 0) return 0

  let total = 0
  for (let i = 0; i < ids.length; i += CAMPAIGN_ID_CHUNK) {
    const chunk = ids.slice(i, i + CAMPAIGN_ID_CHUNK)
    const { count, error } = await supabase
      .from("campaign_messages")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", chunk)
      .eq("status", "sent")
      .gte("sent_at", since)

    if (error) {
      console.warn("[mailbox-daily-send-cap] sent count query:", error.message ?? error)
      return 0
    }
    total += count ?? 0
  }

  return total
}

export async function isMailboxAtDailySendCap(
  supabase: SupabaseClient,
  senderEmail: string | null,
  ownerUserId: string
): Promise<boolean> {
  const cap = getEffectiveMailboxRollingSendCap()
  if (cap === null || !senderEmail) return false
  const n = await countMailboxSendsRolling24h(supabase, ownerUserId)
  return n >= cap
}
