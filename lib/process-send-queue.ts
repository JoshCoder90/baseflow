/**
 * Single invocation: process at most one due campaign_message (global queue).
 * Call from API routes, instrumentation, or scripts — no HTTP self-fetch required.
 */

import { createClient } from "@supabase/supabase-js"
import {
  processGlobalSingleQueuedSend,
  type GlobalTickResult,
} from "@/lib/process-global-send-queue-tick"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export type ProcessSendQueueResult =
  | { ok: true; data: GlobalTickResult }
  | { ok: false; status: number; data: { error: string } }

export async function processSendQueue(): Promise<ProcessSendQueueResult> {
  if (!supabaseServiceKey) {
    return {
      ok: false,
      status: 500,
      data: { error: "SUPABASE_SERVICE_KEY missing" },
    }
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const result = await processGlobalSingleQueuedSend(supabase)

  const message = result.messageId
  if (message) {
    console.log("Found message:", message)
  }

  return { ok: true, data: result }
}
