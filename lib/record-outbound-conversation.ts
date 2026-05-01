import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Upsert `conversations` after an outbound send so dashboard inbox ordering / read state stay consistent.
 * Mirrors the logic in `app/(dashboard)/dashboard/inbox/page.tsx` `recordOutboundConversation`.
 */
export async function recordOutboundConversationRow(
  supabase: SupabaseClient,
  params: { userId: string; threadId: string; lastActivityAt: string }
): Promise<void> {
  const { userId, threadId, lastActivityAt } = params
  const now = new Date().toISOString()
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabase
      .from("conversations")
      .update({
        last_read_at: now,
        last_message_at: lastActivityAt,
        last_message_role: "outbound",
        updated_at: now,
      })
      .eq("id", existing.id as string)
    if (error) console.warn("[recordOutboundConversationRow] update:", error.message)
  } else {
    const { error } = await supabase.from("conversations").insert({
      user_id: userId,
      thread_id: threadId,
      last_read_at: now,
      last_message_at: lastActivityAt,
      last_message_role: "outbound",
      updated_at: now,
    })
    if (error) console.warn("[recordOutboundConversationRow] insert:", error.message)
  }
}
