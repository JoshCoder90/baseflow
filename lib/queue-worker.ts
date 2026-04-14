/**
 * Long-running send-queue poller: calls processSendQueue() on an interval.
 * Start once from instrumentation.ts when the Node server boots (not from React).
 */

import { processSendQueue } from "@/lib/process-send-queue"

const globalForWorker = globalThis as typeof globalThis & {
  __bfQueueWorkerStarted?: boolean
}

function shouldStartQueueWorker(): boolean {
  if (process.env.NEXT_RUNTIME === "edge") return false
  if (process.env.DISABLE_SERVER_QUEUE_POLLER === "1") return false
  if (process.env.NODE_ENV === "development") return true
  if (process.env.ENABLE_SERVER_QUEUE_POLLER === "1") return true
  if (process.env.VERCEL !== "1") return true
  return false
}

export function startQueueWorker() {
  if (!shouldStartQueueWorker()) return
  if (globalForWorker.__bfQueueWorkerStarted) return
  globalForWorker.__bfQueueWorkerStarted = true

  const intervalMs = Math.max(
    5000,
    Number(process.env.SERVER_QUEUE_POLL_MS || 10_000) || 10_000
  )

  console.log("Queue worker started")

  const tick = async () => {
    try {
      console.log("Processing queue...")
      const out = await processSendQueue()
      if (!out.ok) {
        console.error("processSendQueue:", out.data.error)
      }
    } catch (err) {
      console.error("Worker error:", err)
    }
  }

  setInterval(tick, intervalMs)
  setTimeout(tick, 1500)
}
