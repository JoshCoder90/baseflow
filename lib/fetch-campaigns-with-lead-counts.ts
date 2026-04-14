import type { SupabaseClient } from "@supabase/supabase-js"

export type CampaignWithLeadCount = {
  id: string
  name: string | null
  status: string | null
  created_at: string | null
  leadCount: number
}

function leadCountFromRelation(leads: unknown): number {
  if (!Array.isArray(leads) || leads.length === 0) return 0
  const first = leads[0] as { count?: number }
  return typeof first?.count === "number" ? first.count : 0
}

export async function fetchCampaignsWithLeadCounts(
  supabase: SupabaseClient,
  userId: string
): Promise<CampaignWithLeadCount[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, status, created_at, leads(count)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[fetchCampaignsWithLeadCounts]", error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    leadCount: leadCountFromRelation((row as { leads?: unknown }).leads),
  }))
}
