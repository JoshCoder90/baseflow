import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getAccountHealth } from "@/lib/account-health"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params
  if (!campaignId) {
    return NextResponse.json({ error: "Campaign ID required" }, { status: 400 })
  }

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""
  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: SUPABASE_SERVICE_KEY missing" },
      { status: 500 }
    )
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: gmailConn } = await supabase
    .from("gmail_connections")
    .select("gmail_connected_at, created_at")
    .eq("user_id", user.id)
    .maybeSingle()

  const { dailyLimit: DAILY_LIMIT } = getAccountHealth({
    created_at: user?.created_at,
    gmail_connected_at:
      (gmailConn?.gmail_connected_at as string | null | undefined) ??
      (gmailConn?.created_at as string | null | undefined),
  })

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id, audience_id, follow_up_schedule")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const [
    { data: pendingMessages },
    { data: nextPending },
    { count: sent },
    { count: failed },
  ] = await Promise.all([
    supabase
      .from("campaign_messages")
      .select("step_number")
      .eq("campaign_id", campaignId)
      .eq("status", "pending"),
    supabase
      .from("campaign_messages")
      .select("send_at, step_number")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("send_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("campaign_messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent"),
    supabase
      .from("campaign_messages")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "failed"),
  ])

  const pending = pendingMessages ?? []
  const initial = pending.filter((m) => m.step_number === 1).length
  const nudge = pending.filter((m) => m.step_number === 2).length
  const followUp = pending.filter((m) => m.step_number === 3).length
  const final = pending.filter((m) => m.step_number === 4).length

  const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"
  const { data: userCampaigns } = await supabase
    .from("campaigns")
    .select("id")
    .eq("user_id", user.id)
  const campaignIds = (userCampaigns ?? []).map((c) => c.id)
  let dailySentToday = 0
  if (campaignIds.length > 0) {
    const { count } = await supabase
      .from("campaign_messages")
      .select("*", { count: "exact", head: true })
      .in("campaign_id", campaignIds)
      .eq("status", "sent")
      .gte("sent_at", todayStart)
    dailySentToday = count ?? 0
  }

  // Always fetch leads by campaign_id first (never filter by campaign status)
  let leads: { id: string; name: string | null; phone: string | null; email: string | null; status: string | null; deal_stage: string | null; company: string | null; website?: string | null; archived?: boolean | null }[] | null
  const { data: leadsByCampaign } = await supabase
    .from("leads")
    .select("id, name, phone, email, status, deal_stage, company, website, archived")
    .eq("campaign_id", campaignId)
    .order("name")
  leads = leadsByCampaign
  // Fallback for legacy campaigns that use audience_id
  if ((leads?.length ?? 0) === 0 && campaign.audience_id) {
    const { data: leadsByAudience } = await supabase
      .from("leads")
      .select("id, name, phone, email, status, deal_stage, company, website, archived")
      .eq("audience_id", campaign.audience_id)
      .order("name")
    leads = leadsByAudience
  }

  const leadIds = (leads ?? []).map((l) => l.id)
  const totalLeads = (leads ?? []).length

  const { data: sentMessages } = await supabase
    .from("campaign_messages")
    .select("lead_id")
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
  const uniqueLeadsContacted = new Set((sentMessages ?? []).map((m) => m.lead_id)).size
  const remainingLeads = Math.max(0, totalLeads - uniqueLeadsContacted)

  if (leadIds.length === 0) {
    const { data: nextPendingEmpty } = await supabase
      .from("campaign_messages")
      .select("send_at, step_number")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("send_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    let step2LabelEarly = "Nudge"
    try {
      const sched = campaign?.follow_up_schedule
      if (sched && typeof sched === "string") {
        const arr = JSON.parse(sched) as { type?: string }[]
        if (arr?.[0]?.type === "bump") step2LabelEarly = "Bump"
      }
    } catch {
      // use default
    }
    const PHASE_EARLY: Record<number, string> = {
      1: "Initial Messages",
      2: step2LabelEarly,
      3: "Follow-up",
      4: "Final Check-in",
    }
    const nextStepEarly = nextPendingEmpty?.step_number as number | undefined
    const currentPhaseEarly =
      pending.length === 0
        ? "Completed"
        : nextStepEarly != null && PHASE_EARLY[nextStepEarly]
          ? PHASE_EARLY[nextStepEarly]
          : "Initial Messages"
    return NextResponse.json({
      leads: [],
      totalLeads: 0,
      uniqueLeadsContacted: 0,
      sendingStats: { messagesSent: sent ?? 0, initial, nudge, followUp, final, failedSends: failed ?? 0, replyRate: 0, dailySent: dailySentToday, dailyLimit: DAILY_LIMIT },
      replies: [],
      analytics: { messagesSent: sent ?? 0, replies: 0, interestedLeads: 0, meetingsBooked: 0, replyRate: 0 },
      nextScheduledAt: nextPendingEmpty?.send_at ?? null,
      currentPhase: currentPhaseEarly,
      leadsRemaining: 0,
    })
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("lead_id, role, content, created_at")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false })

  const msgs = messages ?? []

  const outboundByLead: Record<string, { count: number; lastAt: string | null }> = {}
  const inboundByLead: Record<string, { content: string; created_at: string }> = {}
  for (const m of msgs) {
    const lid = m.lead_id as string
    if (m.role === "outbound") {
      if (!outboundByLead[lid]) outboundByLead[lid] = { count: 0, lastAt: null }
      outboundByLead[lid].count++
      if (!outboundByLead[lid].lastAt) outboundByLead[lid].lastAt = m.created_at as string
    } else if (m.role === "inbound" || m.role === "lead") {
      if (!(lid in inboundByLead)) {
        inboundByLead[lid] = { content: (m.content as string) ?? "", created_at: (m.created_at as string) ?? "" }
      }
    }
  }

  const repliedCount = Object.keys(inboundByLead).length
  const replyRate = leadIds.length > 0 ? Math.round((repliedCount / leadIds.length) * 100) : 0

  let scheduleDays = [1, 3, 7, 14]
  try {
    const sched = campaign?.follow_up_schedule
    if (sched && typeof sched === "string") {
      const arr = JSON.parse(sched) as { day?: number }[]
      if (Array.isArray(arr) && arr.length > 0) {
        const days = arr.map((s) => s.day ?? 3).filter((d) => d >= 3).sort((a, b) => a - b)
        scheduleDays = [1, ...days]
      }
    }
  } catch {
    // use default
  }

  const prospects = (leads ?? []).map((lead) => {
    const outbound = outboundByLead[lead.id]
    const inbound = inboundByLead[lead.id]
    let contactStatus = "Not Contacted"
    if (inbound) contactStatus = lead.deal_stage === "Closed" ? "Closed" : lead.deal_stage === "Interested" || lead.deal_stage === "Call Booked" ? "Interested" : "Replied"
    else if (outbound) contactStatus = "Contacted"

    let lastActivity: string
    if (lead.deal_stage === "Closed") lastActivity = "Closed"
    else if (lead.deal_stage === "Interested" || lead.deal_stage === "Call Booked") lastActivity = "Interested"
    else if (inbound) lastActivity = "Replied"
    else if (outbound) {
      const day = scheduleDays[Math.min(outbound.count - 1, scheduleDays.length - 1)] ?? scheduleDays[scheduleDays.length - 1]
      lastActivity = outbound.count === 1 ? `Day ${day} message sent` : `Day ${day} follow-up sent`
    } else lastActivity = "—"

    return {
      ...lead,
      lastContacted: outbound?.lastAt ?? null,
      contactStatus,
      lastActivity,
    }
  })

  const repliesList = (leads ?? [])
    .filter((l) => l.id in inboundByLead && !(l.archived ?? false))
    .map((lead) => {
      const inv = inboundByLead[lead.id]
      return {
        leadId: lead.id,
        leadName: lead.name ?? lead.company ?? "—",
        company: lead.company ?? "—",
        messagePreview: (inv.content ?? "").slice(0, 120) + (inv.content && inv.content.length > 120 ? "…" : ""),
        messageContent: inv.content ?? "",
        createdAt: inv.created_at,
        replyStatus: lead.deal_stage === "Closed" ? "Closed" : lead.deal_stage === "Interested" || lead.deal_stage === "Call Booked" ? "Interested" : "Replied",
      }
    })

  const interestedCount = (leads ?? []).filter(
    (l) => l.deal_stage === "Interested" || l.deal_stage === "Call Booked"
  ).length
  const meetingsCount = (leads ?? []).filter((l) => l.deal_stage === "Call Booked").length
  const analyticsReplyRate = (sent ?? 0) > 0 ? (repliedCount / (sent ?? 0)) * 100 : 0

  const nextScheduledAt = nextPending?.send_at ?? null

  let step2Label = "Nudge"
  try {
    const sched = campaign?.follow_up_schedule
    if (sched && typeof sched === "string") {
      const arr = JSON.parse(sched) as { type?: string }[]
      const first = arr?.[0]
      if (first?.type === "bump") step2Label = "Bump"
    }
  } catch {
    // use default
  }

  const PHASE_BY_STEP: Record<number, string> = {
    1: "Initial Messages",
    2: step2Label,
    3: "Follow-up",
    4: "Final Check-in",
  }
  const nextStep = nextPending?.step_number as number | undefined
  const currentPhase =
    pending.length === 0
      ? "Completed"
      : nextStep != null && PHASE_BY_STEP[nextStep]
        ? PHASE_BY_STEP[nextStep]
        : "Initial Messages"

  return NextResponse.json({
    leads: prospects,
    sendingStats: {
      messagesSent: sent ?? 0,
      initial,
      nudge,
      followUp,
      final,
      failedSends: failed ?? 0,
      replyRate,
      dailySent: dailySentToday,
      dailyLimit: DAILY_LIMIT,
    },
    replies: repliesList,
    analytics: {
      messagesSent: sent ?? 0,
      replies: repliedCount,
      interestedLeads: interestedCount,
      meetingsBooked: meetingsCount,
      replyRate: analyticsReplyRate,
    },
    nextScheduledAt,
    currentPhase,
    totalLeads,
    uniqueLeadsContacted,
    leadsRemaining: remainingLeads,
  })
}
