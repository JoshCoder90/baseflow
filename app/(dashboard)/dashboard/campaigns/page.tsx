import { createClient as createServiceClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getQueueStatsMapForCampaignIds } from "@/lib/get-campaign-stats"
import { CampaignsPageClient } from "./CampaignsPageClient"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  audience_id?: string | null
  message_template?: string | null
  status?: string | null
  created_at?: string | null
  sent_count?: number | null
  queue_not_sent?: number | null
}

async function getCampaigns(): Promise<Campaign[]> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("FAILED TO LOAD CAMPAIGNS:", error)
    return []
  }

  const rows = (campaigns ?? []) as Campaign[]
  const ids = rows.map((c) => c.id)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ""
  const statsClient =
    serviceKey && supabaseUrl
      ? createServiceClient(supabaseUrl, serviceKey)
      : supabase
  const statsMap = await getQueueStatsMapForCampaignIds(statsClient, ids)

  return rows.map((c) => {
    const s = statsMap.get(c.id) ?? { sent: 0, notSent: 0 }
    return {
      ...c,
      sent_count: s.sent,
      queue_not_sent: s.notSent,
    }
  })
}

export default async function CampaignsPage() {
  const campaigns = await getCampaigns()
  return <CampaignsPageClient initialCampaigns={campaigns as Campaign[]} />
}
