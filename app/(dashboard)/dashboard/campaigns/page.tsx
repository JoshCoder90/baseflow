import { supabase } from "@/lib/supabase"
import { CampaignsPageClient } from "./CampaignsPageClient"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  message_template?: string | null
  follow_up_schedule?: string | null
  status?: string | null
  created_at?: string | null
}

async function getCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Campaigns fetch error:", error.message)
    return []
  }
  return (data ?? []) as Campaign[]
}

export default async function CampaignsPage() {
  const campaigns = await getCampaigns()
  return <CampaignsPageClient initialCampaigns={campaigns as Campaign[]} />
}
