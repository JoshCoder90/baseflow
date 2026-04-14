/**
 * Per connected Gmail mailbox: max sends in a rolling 24h window (abuse guard).
 * Counts rows with status sent, sender_email set, and sent_at in the window.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export const DAILY_MAILBOX_SEND_CAP = 200

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
    console.error("[mailbox-daily-send-cap] count query:", error)
    return DAILY_MAILBOX_SEND_CAP
  }

  return count ?? 0
}

export async function isMailboxAtDailySendCap(
  supabase: SupabaseClient,
  senderEmail: string | null
): Promise<boolean> {
  if (!senderEmail) return false
  const n = await countMailboxSendsRolling24h(supabase, senderEmail)
  return n >= DAILY_MAILBOX_SEND_CAP
}
