import type { SupabaseClient } from "@supabase/supabase-js"

export type CampaignForSendQueue = {
  id: string
  user_id: string
  subject: string | null
  message_template: string | null
  sent_count: number | null
  status: string | null
}

/** Single row for the authenticated owner, or null if missing / wrong user. */
export async function getCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<CampaignForSendQueue | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, user_id, subject, message_template, sent_count, status")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single()

  if (error || !data) return null
  return data as CampaignForSendQueue
}
