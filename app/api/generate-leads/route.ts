import { NextResponse } from "next/server"

/**
 * Legacy monolithic scraper — disabled. Campaign leads are produced only by
 * POST /api/scrape-batch (see `runCampaignScrapeBatch` in campaign-scrape-engine).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Disabled",
      message: "Use POST /api/scrape-batch with { campaignId } for campaign scraping.",
    },
    { status: 410 }
  )
}
