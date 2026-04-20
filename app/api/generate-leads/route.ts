import { NextResponse } from "next/server"

/**
 * Legacy monolithic scraper — disabled. Campaign leads are produced only by
 * POST /api/scrape-batch?id=<uuid> (see `runCampaignScrapeBatch` in campaign-scrape-engine).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Disabled",
      message: "Use POST /api/scrape-batch?id=<campaign-uuid> for campaign scraping.",
    },
    { status: 410 }
  )
}
