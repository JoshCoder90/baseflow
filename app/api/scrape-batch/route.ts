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
  try {
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

    const body = (await req.json()) as { campaignId?: string; campaign_id?: string }
    console.log("STEP 3: body parsed", body)

    const rawCampaignId = body.campaignId ?? body.campaign_id
    console.log("STEP 4: campaignId raw", rawCampaignId)

    if (!rawCampaignId) {
      return NextResponse.json({ error: "Missing campaignId" }, { status: 400 })
    }

    const v = validateUuid(rawCampaignId, "campaignId")
    if (!v.ok) return v.response

    const campaignId = v.value
    console.log("STEP 5: campaignId", campaignId)

    console.log("STEP 6: fetching campaign")

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: campaign, error: campaignFetchErr } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single()

    console.log("STEP 7: campaign result", { campaign, campaignFetchErr })

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
