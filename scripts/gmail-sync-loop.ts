/**
 * Standalone process: same poller as instrumentation (POST /api/sync-gmail-replies).
 * Run: npm run gmail-sync-loop
 */

import { config } from "dotenv"
import { startGmailSyncLoop } from "@/lib/gmail-sync-loop"

config({ path: ".env.local" })

startGmailSyncLoop()
