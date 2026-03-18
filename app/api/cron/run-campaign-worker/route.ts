import { NextResponse } from "next/server"
import { runCampaignWorker } from "@/lib/campaign-worker"

/**
 * Triggers the campaign worker for all active campaigns.
 * Call this every 60 seconds (e.g. from the worker script or external cron).
 */
export async function GET() {
  const sent = await runCampaignWorker()
  return NextResponse.json({ processed: sent })
}

export async function POST() {
  const sent = await runCampaignWorker()
  return NextResponse.json({ processed: sent })
}
