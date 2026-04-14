/**
 * Optional HTTP poller: hits POST /api/process-send-queue (same as Supabase queue ticks).
 * Requires Next.js running. Prefer: npm run queue-worker
 *
 * Env: WORKER_URL (default http://localhost:3000/api/process-send-queue)
 *      CRON_SECRET — if set in the app, send Authorization: Bearer <secret>
 */

require("dotenv").config({ path: ".env.local" })

const WORKER_URL =
  process.env.WORKER_URL || "http://localhost:3000/api/process-send-queue"
const CRON_SECRET = process.env.CRON_SECRET

async function tick() {
  try {
    const headers = {}
    if (CRON_SECRET) {
      headers.Authorization = `Bearer ${CRON_SECRET}`
    }
    const res = await fetch(WORKER_URL, { method: "POST", headers })
    const data = await res.json().catch(() => ({}))
    if (data.processed != null && data.processed > 0) {
      console.log("process-send-queue processed", data.processed)
    }
  } catch (err) {
    console.error("Queue tick fetch failed:", err.message)
  }
}

console.log("Queue HTTP poller —", WORKER_URL, "every 60s")
tick()
setInterval(tick, 60000)
