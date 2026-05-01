import type { SupabaseClient } from "@supabase/supabase-js"

/** True when the signed-in user may read/update this lead (direct owner or via campaign/audience). */
export async function userCanAccessLeadRow(
  supabase: SupabaseClient,
  userId: string,
  leadId: string
): Promise<boolean> {
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, user_id, campaign_id, audience_id")
    .eq("id", leadId)
    .maybeSingle()

  if (error || !lead) return false
  if (lead.user_id === userId) return true

  const campaignId = lead.campaign_id as string | null | undefined
  if (campaignId) {
    const { data: c } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("user_id", userId)
      .maybeSingle()
    if (c) return true
  }

  const audienceId = lead.audience_id as string | null | undefined
  if (audienceId) {
    const { data: a } = await supabase
      .from("audiences")
      .select("id")
      .eq("id", audienceId)
      .eq("user_id", userId)
      .maybeSingle()
    if (a) return true
  }

  return false
}
