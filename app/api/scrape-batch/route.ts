import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { dailyUsageLimitResponseIfExceeded } from "@/lib/daily-usage-limit"
import { runCampaignScrapeBatch } from "@/lib/campaign-scrape-engine"

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_SERVICE_KEY missing from env")
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: Request) {
  throw new Error("SCRAPE ROUTE HIT")

  try {
    console.log("BACKEND SUPABASE URL:", process.env.NEXT_PUBLIC_SUPABASE_URL)

    console.log("STEP 1: route hit")

    const _ip = heavyRouteIpLimitResponse(req, "scrape-batch")
    if (_ip) return _ip

    console.log("STEP 2: loading session")
    const auth = await createServerClient()
    const {
      data: { user: sessionUser },
    } = await auth.auth.getUser()
    if (!sessionUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const campaignId = searchParams.get("id") || ""

    console.log("SCRAPE ROUTE ID:", campaignId)

    const allCampaigns = await supabase.from("campaigns").select("*")
    console.log("All campaigns:", allCampaigns.data)
    if (allCampaigns.error) {
      console.error("All campaigns query error:", allCampaigns.error)
    }

    console.log("STEP 6: fetching campaign by id")

    console.log("SCRAPE CAMPAIGN ID:", campaignId)

    console.log("QUERYING FOR ID:", campaignId)

    console.log("SUPABASE URL (backend):", process.env.NEXT_PUBLIC_SUPABASE_URL)

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle()

    console.log("CAMPAIGN RESULT:", campaign)
    console.log("CAMPAIGN ERROR:", error)

    if (error) {
      console.error("Campaign fetch error:", error)
      return NextResponse.json(
        { ok: false, error: error.message, campaignId },
        { status: 400 }
      )
    }

    if (!campaign) {
      return Response.json({
        ok: false,
        error: "Campaign not found",
        debugCampaignId: campaignId,
      })
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

    console.log("STEP 8: calling Google API / scrape batch")

    const result = await runCampaignScrapeBatch({
      supabase,
      campaignId,
      userId: sessionUser.id,
      apiKey,
    })

    console.log("STEP 9: scrape batch complete (Google + inserts)", result)

    if (!result.ok && result.error && result.phase === "needs_init") {
      return NextResponse.json(result, { status: 400 })
    }
    if (!result.ok && result.error) {
      return NextResponse.json(result, { status: result.error === "Unauthorized" ? 403 : 400 })
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error("❌ FULL ERROR:", err)
    console.error("❌ STACK:", err.stack)

    return NextResponse.json(
      {
        error: err.message,
        stack: err.stack,
      },
      { status: 500 }
    )
  }
}
