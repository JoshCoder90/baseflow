import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Deletes `campaign_messages` rows whose `lead_id` no longer exists under this campaign.
 * Handles DBs without working `ON DELETE CASCADE` from `leads` → `campaign_messages`.
 */
export async function deleteOrphanedCampaignMessages(
  supabase: SupabaseClient,
  campaignId: string
): Promise<number> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("audience_id")
    .eq("id", campaignId)
    .maybeSingle()

  const valid = new Set<string>()
  const { data: byCampaign } = await supabase
    .from("leads")
    .select("id")
    .eq("campaign_id", campaignId)
  for (const r of byCampaign ?? []) valid.add(r.id as string)

  const audId = campaign?.audience_id as string | null | undefined
  if (audId) {
    const { data: byAudience } = await supabase
      .from("leads")
      .select("id")
      .eq("audience_id", audId)
    for (const r of byAudience ?? []) valid.add(r.id as string)
  }

  const { data: msgRows } = await supabase
    .from("campaign_messages")
    .select("id, lead_id")
    .eq("campaign_id", campaignId)

  const orphanIds = (msgRows ?? [])
    .filter((m) => !valid.has(String(m.lead_id ?? "")))
    .map((m) => m.id as string)

  if (orphanIds.length === 0) return 0

  let deleted = 0
  const chunk = 200
  for (let i = 0; i < orphanIds.length; i += chunk) {
    const slice = orphanIds.slice(i, i + chunk)
    const { error } = await supabase.from("campaign_messages").delete().in("id", slice)
    if (!error) deleted += slice.length
    else console.error("[deleteOrphanedCampaignMessages]", error.message)
  }

  if (deleted > 0) {
    console.log(
      `[deleteOrphanedCampaignMessages] removed ${deleted} orphan message(s) for campaign ${campaignId}`
    )
  }

  return deleted
}
