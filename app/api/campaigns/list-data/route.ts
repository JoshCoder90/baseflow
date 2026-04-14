import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getQueueStatsMapForCampaignIds } from "@/lib/get-campaign-stats"
import { rateLimitResponse } from "@/lib/rateLimit"

export const dynamic = "force-dynamic"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

/**
 * Campaign rows for the current user with live `campaign_messages` counts (no-store, for list polling).
 */
export async function GET(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const serverClient = await createServerClient()
  const {
    data: { user },
  } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[campaigns/list-data]", error)
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 })
  }

  const rows = campaigns ?? []
  const ids = rows.map((c) => c.id as string)
  const statsMap = await getQueueStatsMapForCampaignIds(supabase, ids)

  const merged = rows.map((c) => {
    const id = c.id as string
    const s = statsMap.get(id) ?? { sent: 0, notSent: 0 }
    return {
      ...c,
      sent_count: s.sent,
      queue_not_sent: s.notSent,
    }
  })

  return NextResponse.json(
    { campaigns: merged },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
  )
}
