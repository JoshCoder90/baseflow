import type { SupabaseClient } from "@supabase/supabase-js"
import { deleteOrphanedCampaignMessages } from "@/lib/campaign-messages-cleanup"
import { isValidEmail } from "@/lib/campaign-message-insert-email"
import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"
import { personalizeMessage } from "@/lib/lead-personalization"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import { CAMPAIGN_SEND_GAP_MS } from "@/lib/campaign-send-schedule-constants"

export { CAMPAIGN_SEND_GAP_MS }

type LeadRow = {
  id: string
  user_id: string | null
  email: string | null
  name: string | null
  company: string | null
  status: string | null
}

/**
 * All leads for a campaign (for building the message queue). Same filters as outreach eligibility.
 */
export async function getLeadsByCampaign(
  supabase: SupabaseClient,
  campaignId: string
): Promise<LeadRow[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, user_id, email, name, company, status")
    .eq("campaign_id", campaignId)
    .order("id", { ascending: true })

  if (error) {
    console.error("[campaign-schedule] getLeadsByCampaign:", error)
    return []
  }
  return (data ?? []) as LeadRow[]
}

/**
 * Ensure one step-1 campaign_message per eligible lead (email, not sent/invalid).
 * Inserts rows with status `pending` and next_send_at null; scheduling assigns times next.
 */
export async function ensureCampaignMessagesForCampaign(
  supabase: SupabaseClient,
  campaignId: string
): Promise<number> {
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("message_template")
    .eq("id", campaignId)
    .single()

  if (cErr || !campaign) {
    console.error("[campaign-schedule] ensureCampaignMessagesForCampaign: campaign", cErr)
    return 0
  }

  const template = (campaign.message_template ?? "").trim() || "Hey {{first_name}}, I wanted to reach out."

  const { data: existingRows } = await supabase
    .from("campaign_messages")
    .select("lead_id")
    .eq("campaign_id", campaignId)
    .eq("step_number", 1)

  const existingLeadIds = new Set((existingRows ?? []).map((r) => r.lead_id as string))

  const leads = await getLeadsByCampaign(supabase, campaignId)
  let inserted = 0
  let filteredCount = 0

  for (const lead of leads) {
    if (existingLeadIds.has(lead.id)) continue

    const email = typeof lead.email === "string" ? lead.email.trim() : ""
    if (!email) continue
    if (lead.status === "sent" || lead.status === "invalid_email") continue

    if (!isValidEmail(email)) {
      filteredCount++
      console.log("Filtered invalid email:", email)
      continue
    }

    if (!isEmailAllowedForCampaignQueue(email)) {
      await supabase.from("leads").update({ status: "invalid_email" }).eq("id", lead.id)
      continue
    }

    const messageBody = personalizeMessage(template, lead)
    const sendAt = new Date().toISOString()

    const { error: insErr } = await supabase.from("campaign_messages").insert({
      campaign_id: campaignId,
      lead_id: lead.id,
      step_number: 1,
      channel: OUTBOUND_EMAIL_CHANNEL,
      message_body: messageBody,
      send_at: sendAt,
      status: "pending",
      next_send_at: null,
      user_id: lead.user_id,
    })

    if (!insErr) {
      inserted++
      existingLeadIds.add(lead.id)
    } else {
      console.error("[campaign-schedule] insert campaign_message:", lead.id, insErr)
    }
  }

  console.log("[campaign-schedule] Filtered emails:", filteredCount)

  return inserted
}

/**
 * After a lead is saved (or gains an email), ensure one step-1 `campaign_messages` row exists.
 * Idempotent; skips leads without a queueable email. Matches {@link ensureCampaignMessagesForCampaign} payload.
 */
export async function ensureInitialCampaignMessageForLead(
  supabase: SupabaseClient,
  campaignId: string,
  leadId: string
): Promise<void> {
  const { data: existing, error: existingErr } = await supabase
    .from("campaign_messages")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("lead_id", leadId)
    .eq("step_number", 1)
    .maybeSingle()

  if (existingErr) {
    console.error("[campaign-schedule] ensureInitial existing:", existingErr)
    return
  }
  if (existing?.id) return

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, user_id, email, name, company, status")
    .eq("id", leadId)
    .eq("campaign_id", campaignId)
    .maybeSingle()

  if (leadErr || !lead) return

  const email = typeof lead.email === "string" ? lead.email.trim() : ""
  if (!email) return
  if (lead.status === "sent" || lead.status === "invalid_email") return

  if (!isValidEmail(email)) {
    return
  }

  if (!isEmailAllowedForCampaignQueue(email)) {
    await supabase.from("leads").update({ status: "invalid_email" }).eq("id", leadId)
    return
  }

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("message_template")
    .eq("id", campaignId)
    .single()

  if (cErr || !campaign) {
    console.error("[campaign-schedule] ensureInitial campaign:", cErr)
    return
  }

  const template =
    (campaign.message_template ?? "").trim() ||
    "Hey {{first_name}}, I wanted to reach out."
  const messageBody = personalizeMessage(template, lead)
  const sendAt = new Date().toISOString()

  const { error: insErr } = await supabase.from("campaign_messages").insert({
    campaign_id: campaignId,
    lead_id: leadId,
    step_number: 1,
    channel: OUTBOUND_EMAIL_CHANNEL,
    message_body: messageBody,
    send_at: sendAt,
    status: "pending",
    next_send_at: null,
    user_id: lead.user_id,
  })

  if (insErr) {
    console.error("[campaign-schedule] ensureInitial insert:", leadId, insErr)
  }
}

/**
 * Unsent campaign_messages: status queued, staggered next_send_at (30s grid), stable order.
 */
export async function rescheduleCampaignMessagesForCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  baseMs: number
): Promise<number> {
  const { data: rows, error } = await supabase
    .from("campaign_messages")
    .select("id")
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "queued"])
    .is("sent_at", null)
    .order("step_number", { ascending: true })
    .order("id", { ascending: true })

  if (error) {
    console.error("[campaign-schedule] rescheduleCampaignMessagesForCampaign:", error)
    return 0
  }

  let count = 0
  for (let index = 0; index < (rows ?? []).length; index++) {
    const row = rows![index]
    const nextSendAt = new Date(baseMs + index * CAMPAIGN_SEND_GAP_MS).toISOString()

    const { error: upErr } = await supabase
      .from("campaign_messages")
      .update({
        status: "queued",
        next_send_at: nextSendAt,
      })
      .eq("id", row.id)
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "queued"])
      .is("sent_at", null)

    if (!upErr) count++
    else console.error("[campaign-schedule] campaign_messages update failed:", row.id, upErr)
  }
  return count
}

/** Any in-flight `sending` message row is put back to `queued` so it can be rescheduled with the rest. */
export async function resetSendingCampaignMessages(
  supabase: SupabaseClient,
  campaignId: string
): Promise<void> {
  await supabase
    .from("campaign_messages")
    .update({ status: "queued" })
    .eq("campaign_id", campaignId)
    .eq("status", "sending")
}

/**
 * Start / resume: create missing campaign_messages rows, then assign unique next_send_at (30s apart).
 */
export async function applyCampaignSendSchedule(
  supabase: SupabaseClient,
  campaignId: string
): Promise<{ messagesInserted: number; messagesScheduled: number }> {
  await deleteOrphanedCampaignMessages(supabase, campaignId)

  const messagesInserted = await ensureCampaignMessagesForCampaign(supabase, campaignId)

  const baseMs = Date.now()
  await resetSendingCampaignMessages(supabase, campaignId)

  const messagesScheduled = await rescheduleCampaignMessagesForCampaign(
    supabase,
    campaignId,
    baseMs
  )

  return { messagesInserted, messagesScheduled }
}
