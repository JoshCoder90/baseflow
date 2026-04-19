import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { validateUuid } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { dailyUsageLimitResponseIfExceeded } from "@/lib/daily-usage-limit"
import { runCampaignScrapeBatch } from "@/lib/campaign-scrape-engine"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

if (!supabaseServiceKey) {
  throw new Error("SUPABASE_SERVICE_KEY missing from env")
}

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "scrape-batch")
  if (_ip) return _ip

  const auth = await createServerClient()
  const {
    data: { user: sessionUser },
  } = await auth.auth.getUser()
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { campaignId?: string; campaign_id?: string }
  try {
    body = (await req.json()) as { campaignId?: string; campaign_id?: string }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const rawCampaignId = body.campaignId ?? body.campaign_id
  if (!rawCampaignId) {
    return NextResponse.json({ error: "Missing campaignId" }, { status: 400 })
  }

  const v = validateUuid(rawCampaignId, "campaignId")
  if (!v.ok) return v.response

  const campaignId = v.value
  console.log("SCRAPE BATCH RUNNING", campaignId)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: campaign, error: campaignFetchErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single()

  if (campaignFetchErr || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  if ((campaign as { user_id?: string }).user_id !== sessionUser.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const campaignStatus = (campaign as { status?: string | null }).status
  if (campaignStatus === "completed") {
    return NextResponse.json({ error: "Campaign already completed" }, { status: 400 })
  }

  /** While scraping, mark non-send lifecycle rows as `running`; never clobber active/sending/paused/stopped. */
  const preserveWhileScraping = new Set(["active", "sending", "paused", "stopped"])
  if (
    campaignStatus !== "running" &&
    !preserveWhileScraping.has((campaignStatus ?? "").toLowerCase())
  ) {
    await supabase.from("campaigns").update({ status: "running" }).eq("id", campaignId)
  }

  const daily = await dailyUsageLimitResponseIfExceeded(supabase, sessionUser.id)
  if (daily) return daily

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "Google Places API key missing" }, { status: 500 })
  }

  const result = await runCampaignScrapeBatch({
    supabase,
    campaignId,
    userId: sessionUser.id,
    apiKey,
  })

  if (!result.ok && result.error && result.phase === "needs_init") {
    return NextResponse.json(result, { status: 400 })
  }
  if (!result.ok && result.error) {
    return NextResponse.json(result, { status: result.error === "Unauthorized" ? 403 : 400 })
  }

  return NextResponse.json(result)
}
