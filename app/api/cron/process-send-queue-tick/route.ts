import { NextResponse } from "next/server"
import { processSendQueue } from "@/lib/process-send-queue"
import { rateLimitResponse } from "@/lib/rateLimit"

/**
 * @deprecated Prefer POST /api/process-send-queue (same behavior).
 */
export async function GET(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
  }
  return runTick()
}

export async function POST(_req: Request) {
  const _rl = rateLimitResponse(_req)
  if (_rl) return _rl

  if (process.env.CRON_SECRET) {
    const auth = _req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
  }
  return runTick()
}

async function runTick() {
  const out = await processSendQueue()
  if (!out.ok) {
    return NextResponse.json(
      { success: false, error: out.data.error },
      { status: out.status }
    )
  }
  return NextResponse.json({ ...out.data, success: true })
}
