/**
 * Long-running send-queue poller: calls processSendQueue() on an interval.
 * Start once from instrumentation.ts when the Node server boots (not from React).
 */

import { processSendQueue } from "@/lib/process-send-queue"

const globalForWorker = globalThis as typeof globalThis & {
  __bfQueueWorkerStarted?: boolean
  __bfQueueWorkerInterval?: ReturnType<typeof setInterval>
  __bfQueueWorkerTimeout?: ReturnType<typeof setTimeout>
}

function shouldStartQueueWorker(): boolean {
  if (process.env.NEXT_RUNTIME === "edge") return false
  if (process.env.DISABLE_SERVER_QUEUE_POLLER === "1") return false
  // Manual trigger only unless explicitly enabled.
  return process.env.ENABLE_SERVER_QUEUE_POLLER === "1"
}

export function startQueueWorker() {
  if (!shouldStartQueueWorker()) {
    if (globalForWorker.__bfQueueWorkerInterval) {
      clearInterval(globalForWorker.__bfQueueWorkerInterval)
      globalForWorker.__bfQueueWorkerInterval = undefined
    }
    if (globalForWorker.__bfQueueWorkerTimeout) {
      clearTimeout(globalForWorker.__bfQueueWorkerTimeout)
      globalForWorker.__bfQueueWorkerTimeout = undefined
    }
    globalForWorker.__bfQueueWorkerStarted = false
    return
  }
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

  globalForWorker.__bfQueueWorkerInterval = setInterval(tick, intervalMs)
  globalForWorker.__bfQueueWorkerTimeout = setTimeout(tick, 1500)
}
