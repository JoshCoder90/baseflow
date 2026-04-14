/**
 * Next.js server bootstrap: starts the send-queue poller and Gmail sync once per Node process.
 * On Vercel serverless, prefer vercel.json crons → /api/process-send-queue.
 * Gmail loop only runs when shouldStart matches (see lib/gmail-sync-loop.ts); set ENABLE_GMAIL_AUTO_SYNC=1 on Vercel if needed.
 */

import { startGmailSyncLoop } from "@/lib/gmail-sync-loop"
import { startQueueWorker } from "@/lib/queue-worker"

console.log("SYNC LOOP INIT")
startGmailSyncLoop()

export async function register() {
  startQueueWorker()
}
