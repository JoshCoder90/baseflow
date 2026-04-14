/**
 * Server-only Gmail reply poller: POST /api/sync-gmail-replies on an interval.
 * Started once from instrumentation.ts when the Node server boots (not from React).
 */

const globalForGmail = globalThis as typeof globalThis & {
  __bfGmailSyncLoopStarted?: boolean
}

let isSyncRunning = false

function shouldStartGmailAutoSync(): boolean {
  if (process.env.NEXT_RUNTIME === "edge") return false
  if (process.env.DISABLE_GMAIL_AUTO_SYNC === "1") return false
  if (process.env.NODE_ENV === "development") return true
  if (process.env.ENABLE_GMAIL_AUTO_SYNC === "1") return true
  if (process.env.VERCEL !== "1") return true
  return false
}

function syncEndpointUrl(): string {
  const base = (
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || 3000}`
  ).replace(/\/$/, "")
  return `${base}/api/sync-gmail-replies`
}

export function startGmailSyncLoop() {
  if (!shouldStartGmailAutoSync()) return
  if (globalForGmail.__bfGmailSyncLoopStarted || isSyncRunning) return
  globalForGmail.__bfGmailSyncLoopStarted = true
  isSyncRunning = true

  console.log("Gmail auto-sync started")

  const url = syncEndpointUrl()

  const internalSecret = process.env.GMAIL_SYNC_INTERNAL_SECRET?.trim()
  const internalHeaders =
    internalSecret && internalSecret.length > 0
      ? { "x-baseflow-gmail-sync-internal": internalSecret }
      : undefined

  const tick = async () => {
    try {
      console.log("Auto syncing Gmail...")
      await fetch(url, {
        method: "POST",
        headers: internalHeaders,
      })
    } catch (err) {
      console.error("Gmail auto-sync error:", err)
    }
  }

  setInterval(tick, 15_000)
  setTimeout(tick, 2_000)
}
