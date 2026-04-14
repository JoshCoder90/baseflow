import type { SupabaseClient } from "@supabase/supabase-js"

export type ConversationMessageRole = "inbound" | "outbound"

/**
 * Sets conversations.last_message_at / last_message_role without clearing last_read_at.
 * last_inbound_at is only updated for inbound messages (unread is based on that field).
 */
export async function bumpConversationLastMessage(
  supabase: SupabaseClient,
  params: {
    userId: string
    threadId: string
    messageAt: string
    lastMessageRole: ConversationMessageRole
  }
): Promise<void> {
  const { userId, threadId, messageAt, lastMessageRole } = params
  const now = new Date().toISOString()

  const updatePayload: Record<string, string> = {
    last_message_at: messageAt,
    last_message_role: lastMessageRole,
    updated_at: now,
  }
  if (lastMessageRole === "inbound") {
    updatePayload.last_inbound_at = messageAt
  }

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from("conversations")
      .update(updatePayload)
      .eq("id", existing.id as string)
  } else {
    await supabase.from("conversations").insert({
      user_id: userId,
      thread_id: threadId,
      last_message_at: messageAt,
      last_message_role: lastMessageRole,
      updated_at: now,
      ...(lastMessageRole === "inbound" ? { last_inbound_at: messageAt } : {}),
    })
  }
}
