/**
 * Campaign worker - calls the API every 60 seconds to send outreach emails.
 * Requires Next.js server to be running (npm run dev or npm run start).
 * Run with: node scripts/campaign-worker.js
 */

require("dotenv").config({ path: ".env.local" })

const WORKER_URL = process.env.WORKER_URL || "http://localhost:3000/api/cron/run-campaign-worker"

async function runCampaignWorker() {
  try {
    const res = await fetch(WORKER_URL)
    const data = await res.json()
    if (data.processed > 0) {
      console.log("Campaign worker processed", data.processed, "emails")
    }
  } catch (err) {
    console.error("Campaign worker fetch failed:", err.message)
  }
}

console.log("Campaign worker started - running every 60 seconds")
runCampaignWorker()
setInterval(runCampaignWorker, 60000)
