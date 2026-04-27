import type { SupabaseClient } from "@supabase/supabase-js"

const DEFAULT_STALE_MS = 15 * 60 * 1000

function staleSendingMs(): number {
  const raw = process.env.STALE_SENDING_RELEASE_MS?.trim()
  if (!raw) return DEFAULT_STALE_MS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_STALE_MS
  return Math.min(n, 24 * 60 * 60 * 1000)
}

/**
 * Reverts `sending` → `queued` for rows stuck without `sent_at` past the stale threshold.
 * Prevents one phantom "sending" row from blocking the whole campaign (global worker skips busy campaigns).
 */
export async function releaseStaleSendingClaims(
  supabase: SupabaseClient
): Promise<{ released: number }> {
  const cutoff = new Date(Date.now() - staleSendingMs()).toISOString()

  const { data, error } = await supabase
    .from("campaign_messages")
    .update({
      status: "queued",
      sending_claimed_at: null,
    })
    .eq("status", "sending")
    .is("sent_at", null)
    .not("sending_claimed_at", "is", null)
    .lt("sending_claimed_at", cutoff)
    .select("id")

  if (error) {
    console.error("[release-stale-sending] update failed:", error)
    return { released: 0 }
  }

  const n = Array.isArray(data) ? data.length : 0
  if (n > 0) {
    console.warn(
      `[release-stale-sending] reverted ${n} stuck row(s) (threshold ${staleSendingMs()}ms)`
    )
  }
  return { released: n }
}
