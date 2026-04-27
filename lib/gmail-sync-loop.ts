/**
 * Server-only Gmail reply poller: POST /api/sync-gmail-replies on an interval.
 * Started once from instrumentation.ts when the Node server boots (not from React).
 */

const globalForGmail = globalThis as typeof globalThis & {
  __bfGmailSyncLoopStarted?: boolean
  __bfGmailSyncInterval?: ReturnType<typeof setInterval>
  __bfGmailSyncTimeout?: ReturnType<typeof setTimeout>
}

function shouldStartGmailAutoSync(): boolean {
  if (process.env.NEXT_RUNTIME === "edge") return false
  if (process.env.DISABLE_GMAIL_AUTO_SYNC === "1") return false
  // Manual trigger only unless explicitly enabled.
  return process.env.ENABLE_GMAIL_AUTO_SYNC === "1"
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
  if (!shouldStartGmailAutoSync()) {
    if (globalForGmail.__bfGmailSyncInterval) {
      clearInterval(globalForGmail.__bfGmailSyncInterval)
      globalForGmail.__bfGmailSyncInterval = undefined
    }
    if (globalForGmail.__bfGmailSyncTimeout) {
      clearTimeout(globalForGmail.__bfGmailSyncTimeout)
      globalForGmail.__bfGmailSyncTimeout = undefined
    }
    globalForGmail.__bfGmailSyncLoopStarted = false
    return
  }
  if (globalForGmail.__bfGmailSyncLoopStarted) return
  globalForGmail.__bfGmailSyncLoopStarted = true

  const url = syncEndpointUrl()

  const internalSecret = process.env.GMAIL_SYNC_INTERNAL_SECRET?.trim()
  const internalHeaders =
    internalSecret && internalSecret.length > 0
      ? { "x-baseflow-gmail-sync-internal": internalSecret }
      : undefined

  let isGmailTickInFlight = false
  const tick = async () => {
    if (isGmailTickInFlight) {
      console.log("[SYNC BLOCKED] Already running")
      return
    }
    isGmailTickInFlight = true
    try {
      await fetch(url, {
        method: "POST",
        headers: internalHeaders,
      })
    } catch (err) {
      console.error("Gmail auto-sync error:", err)
    } finally {
      isGmailTickInFlight = false
    }
  }

  globalForGmail.__bfGmailSyncInterval = setInterval(tick, 60_000)
  globalForGmail.__bfGmailSyncTimeout = setTimeout(tick, 3_000)
}
