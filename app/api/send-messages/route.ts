import { NextRequest, NextResponse } from "next/server"
import { processQueue } from "@/lib/queue-worker"

export async function GET(req: NextRequest) {
  return runQueueHandler(req)
}

export async function POST(req: NextRequest) {
  return runQueueHandler(req)
}

async function runQueueHandler(req: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const processed = await processQueue()
    return NextResponse.json({ processed })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    if (message.includes("missing") || message.includes("required")) {
      return NextResponse.json({ error: message }, { status: 500 })
    }
    console.error("Queue process error:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
