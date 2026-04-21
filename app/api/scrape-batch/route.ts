/**
 * Campaign lead scraping only (Places → enrich → `leads`). No Gmail API, no sync-gmail-replies,
 * no token refresh. Inbound mail sync remains POST /api/sync-gmail-replies only.
 *
 * Places HTTP calls happen inside `runCampaignScrapeBatch` (`lib/campaign-scrape-engine.ts`).
 */
import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { runCampaignScrapeBatch } from "@/lib/campaign-scrape-engine"

export async function POST(req: Request) {
  try {
    console.log("[scrape-batch] start")

    const _ip = heavyRouteIpLimitResponse(req, "scrape-batch")
    if (_ip) return _ip

    const supabase = await createServerClient()

    const {
      data: { user: sessionUser },
      error: authError,
    } = await supabase.auth.getUser()

    console.log("[scrape-batch] user id:", sessionUser?.id ?? "(none)")
    console.log("[scrape-batch] auth error:", authError?.message ?? "(none)")

    if (!sessionUser?.id) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const rawCampaignId = searchParams.get("id")

    if (!rawCampaignId) {
      return NextResponse.json(
        { ok: false, error: "Missing campaignId" },
        { status: 400 }
      )
    }

    const campaignId = rawCampaignId
    console.log("[scrape-batch] campaignId:", campaignId)

    const { data: campaign, error: campaignQueryError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("user_id", sessionUser.id)
      .maybeSingle()

    console.log(
      "[scrape-batch] campaign query result:",
      campaign ? { id: (campaign as { id: string }).id } : null
    )
    console.log(
      "[scrape-batch] campaign query error:",
      campaignQueryError?.message ?? "(none)"
    )

    if (campaignQueryError) {
      return NextResponse.json(
        { ok: false, error: campaignQueryError.message, campaignId },
        { status: 400 }
      )
    }

    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: "Campaign not found" },
        { status: 404 }
      )
    }

    console.log("[scrape-batch] STEP 1 - campaign loaded")

    console.log("[scrape-batch] STEP 2 - starting scrape")

    console.log("[scrape] STEP 2 - starting real scrape")

    console.log("[scrape] STEP 2.1 - building context")
    const targetSearchQuery =
      (campaign as { target_search_query?: string | null }).target_search_query ?? ""
    const locationLat = (campaign as { location_lat?: unknown }).location_lat
    const locationLng = (campaign as { location_lng?: unknown }).location_lng
    const leadGenStatus = (campaign as { lead_generation_status?: string | null })
      .lead_generation_status

    console.log("[scrape] query:", targetSearchQuery)
    console.log("[scrape] location:", { lat: locationLat, lng: locationLng })
    console.log("[scrape] lead_generation_status:", leadGenStatus)

    try {
      const campaignStatus = (campaign as { status?: string | null }).status
      console.log("[scrape] campaign.status:", campaignStatus)

      if (campaignStatus === "completed") {
        console.log("[scrape] early exit: campaign already completed")
        return NextResponse.json(
          {
            ok: false,
            error: "Campaign already completed",
            debug: { campaignId, reason: "campaign_completed" },
          },
          { status: 400 }
        )
      }

      console.log("[scrape] STEP 2.1b - optional campaigns.status → running")
      const preserveWhileScraping = new Set(["active", "sending", "paused", "stopped"])
      if (
        campaignStatus !== "running" &&
        !preserveWhileScraping.has((campaignStatus ?? "").toLowerCase())
      ) {
        const { error: runUpdErr } = await supabase
          .from("campaigns")
          .update({ status: "running" })
          .eq("id", campaignId)
          .eq("user_id", sessionUser.id)

        console.log("[scrape] status→running update error:", runUpdErr?.message ?? "(none)")
      }

      console.log("[scrape] STEP 2.2 - resolving GOOGLE_PLACES_API_KEY")
      const apiKey = process.env.GOOGLE_PLACES_API_KEY
      console.log(
        "[scrape] GOOGLE_PLACES_API_KEY:",
        apiKey ? `(present, length=${apiKey.length})` : "(missing)"
      )

      if (!apiKey) {
        return NextResponse.json(
          {
            ok: false,
            error: "Google Places API key missing",
            debug: { envKey: "GOOGLE_PLACES_API_KEY", campaignId },
          },
          { status: 500 }
        )
      }

      console.log(
        "[scrape] STEP 2.3 - calling runCampaignScrapeBatch (Places + enrichment live in lib)"
      )

      const result = await runCampaignScrapeBatch({
        supabase,
        campaignId,
        userId: sessionUser.id,
        apiKey,
      })

      console.log("[scrape] STEP 2.4 - batch result:", JSON.stringify(result))

      if (!result.ok && result.error) {
        console.warn(
          "[scrape] batch ok=false:",
          "error=",
          result.error,
          "phase=",
          result.phase,
          "scrapedThisBatch=",
          result.scrapedThisBatch
        )
      }

      if (
        result.ok &&
        result.scrapedThisBatch === 0 &&
        result.totalLeadsNow === 0 &&
        !result.skipped
      ) {
        console.warn(
          "[scrape] ZERO leads after batch — check geocode/query, Places quota, checkpoint phase:",
          result.phase,
          "(see also [scrape-batch] / campaign-scrape-engine logs)"
        )
      }

      const debugPayload = {
        campaignId,
        targetSearchQuery,
        phase: result.phase,
        scrapedThisBatch: result.scrapedThisBatch,
        totalLeadsNow: result.totalLeadsNow,
        emailLeadsNow: result.emailLeadsNow,
        done: result.done,
        skipped: result.skipped ?? false,
      }

      if (!result.ok && result.error && result.phase === "needs_init") {
        return NextResponse.json({ ...result, debug: debugPayload }, { status: 400 })
      }
      if (!result.ok && result.error) {
        return NextResponse.json(
          { ...result, debug: debugPayload },
          { status: result.error === "Unauthorized" ? 403 : 400 }
        )
      }

      console.log("[scrape-batch] STEP 3 - scrape finished")

      return NextResponse.json({
        ...result,
        debug: debugPayload,
      })
    } catch (e) {
      console.error("[scrape] CRASH:", e)

      return NextResponse.json(
        { ok: false, error: "SCRAPE FAILED", details: String(e) },
        { status: 500 }
      )
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error("[scrape-batch] exception:", err.message)
    console.error("[scrape-batch] stack:", err.stack)

    return NextResponse.json(
      {
        error: err.message,
        stack: err.stack,
      },
      { status: 500 }
    )
  }
}
