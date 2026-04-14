import { NextResponse } from "next/server"
import { runCampaignWorker } from "@/lib/campaign-worker"
import { rateLimitResponse } from "@/lib/rateLimit"

/**
 * Triggers the campaign worker for all active campaigns.
 * Call this every 60 seconds (e.g. from the worker script or external cron).
 */
export async function GET(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const sent = await runCampaignWorker()
  return NextResponse.json({ processed: sent })
}

export async function POST(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const sent = await runCampaignWorker()
  return NextResponse.json({ processed: sent })
}
