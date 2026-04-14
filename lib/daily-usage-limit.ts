import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

/** Hard cap on combined daily “usage units” (new leads + campaign emails sent) per user (UTC day). */
export const DAILY_USAGE_HARD_LIMIT = 1000

function utcDayStartIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * Counts usage today (UTC): leads created for this user + campaign_messages marked sent
 * for campaigns owned by this user (chunks campaign ids for `.in()` limits).
 * Returns null if any required query failed (caller should treat as over limit).
 */
export async function countUserDailyUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<number | null> {
  const since = utcDayStartIso()

  const { count: leadCount, error: leadErr } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since)

  if (leadErr) {
    console.error("[daily-usage-limit] leads count error:", leadErr)
    return null
  }

  const { data: campaigns, error: campErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("user_id", userId)

  if (campErr) {
    console.error("[daily-usage-limit] campaigns list error:", campErr)
    return null
  }

  const ids = (campaigns ?? []).map((r) => r.id as string)
  let sentTotal = 0
  const chunkSize = 200
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { count, error: sentErr } = await supabase
      .from("campaign_messages")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", chunk)
      .eq("status", "sent")
      .gte("sent_at", since)

    if (sentErr) {
      console.error("[daily-usage-limit] campaign_messages count error:", sentErr)
      return null
    }
    sentTotal += count ?? 0
  }

  return (leadCount ?? 0) + sentTotal
}

/** 429 JSON if at or over the daily cap, or counts could not be verified. */
export async function dailyUsageLimitResponseIfExceeded(
  supabase: SupabaseClient,
  userId: string
): Promise<NextResponse | null> {
  const n = await countUserDailyUsage(supabase, userId)
  if (n === null || n >= DAILY_USAGE_HARD_LIMIT) {
    return NextResponse.json(
      { error: "Daily usage limit reached" },
      { status: 429 }
    )
  }
  return null
}
