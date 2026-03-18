/**
 * Queue worker - calls send-messages API every 10 seconds to auto-send queued emails.
 * Requires Next.js server to be running (npm run dev or npm run start).
 * Run with: node scripts/queue-worker.js
 */

require("dotenv").config({ path: ".env.local" })

const QUEUE_URL = process.env.QUEUE_WORKER_URL || "http://localhost:3000/api/send-messages"
const INTERVAL_MS = 10000 // 10 seconds
const CRON_SECRET = process.env.CRON_SECRET

async function processQueue() {
  try {
    const headers = {}
    if (CRON_SECRET) {
      headers["Authorization"] = `Bearer ${CRON_SECRET}`
    }
    const res = await fetch(QUEUE_URL, { headers })
    const data = await res.json()
    if (data.processed > 0) {
      console.log("Queue worker processed", data.processed, "emails")
    }
  } catch (err) {
    console.error("Queue worker fetch failed:", err.message)
  }
}

console.log("Queue worker started - running every", INTERVAL_MS / 1000, "seconds")
processQueue()
setInterval(processQueue, INTERVAL_MS)
