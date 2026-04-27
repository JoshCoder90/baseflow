import type { SupabaseClient } from "@supabase/supabase-js"

function isLikelySenderEmailSchemaError(err: {
  message?: string
  code?: string
  details?: string
}): boolean {
  const m = String(err.message ?? "")
  const d = String(err.details ?? "")
  return (
    err.code === "PGRST204" ||
    m.includes("sender_email") ||
    d.includes("sender_email")
  )
}

/**
 * Marks `campaign_messages` as sent after Gmail succeeds.
 * Retries without `sender_email` when the column is missing from DB / schema cache (common dev drift).
 */
export async function persistCampaignMessageSentRow(
  supabase: SupabaseClient,
  args: {
    messageId: string
    sentAt: string
    senderMailbox: string | null
  }
): Promise<boolean> {
  const base = {
    status: "sent" as const,
    sent_at: args.sentAt,
    next_send_at: null as null,
  }

  const normalizedSender = args.senderMailbox?.trim().toLowerCase() || ""
  const payload =
    normalizedSender !== ""
      ? { ...base, sender_email: normalizedSender }
      : base

  const attempt = await supabase
    .from("campaign_messages")
    .update(payload)
    .eq("id", args.messageId)
    .eq("status", "sending")

  let error = attempt.error

  if (
    error &&
    normalizedSender !== "" &&
    "sender_email" in payload &&
    isLikelySenderEmailSchemaError(error)
  ) {
    console.warn(
      "[persistCampaignMessageSentRow] sender_email unavailable — marking sent without it. Apply migration 20260413120000_campaign_messages_sender_email.sql"
    )
    const fallback = await supabase
      .from("campaign_messages")
      .update(base)
      .eq("id", args.messageId)
      .eq("status", "sending")
    error = fallback.error
  }

  if (error) {
    console.error("[persistCampaignMessageSentRow] campaign_messages sent update:", error)
    return false
  }
  return true
}
