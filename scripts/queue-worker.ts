/**
 * Standalone process: same poller as the Next.js server (direct processSendQueue).
 * Run: npm run queue-worker
 */

import { config } from "dotenv"
import { startQueueWorker } from "@/lib/queue-worker"

config({ path: ".env.local" })

startQueueWorker()
