import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getAccountHealth } from "@/lib/account-health"
import { getCampaignStats } from "@/lib/get-campaign-stats"
import { rateLimitResponse } from "@/lib/rateLimit"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

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
    .select("id, user_id, audience_id, status")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }

  const queueStats = await getCampaignStats(supabase, campaignId)
  const queueMessagesSent = queueStats.sent
  const queueFailed = queueStats.failed
  const queueNotSent = queueStats.notSent

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

  // Fetch leads by campaign_id
  let leads: { id: string; name: string | null; email: string | null; status: string | null; deal_stage: string | null; company: string | null; website?: string | null; archived?: boolean | null }[] | null
  const { data: leadsByCampaign } = await supabase
    .from("leads")
    .select("id, name, email, status, deal_stage, company, website, archived")
    .eq("campaign_id", campaignId)
    .order("name")
  leads = leadsByCampaign
  // Fallback for legacy campaigns that use audience_id
  if ((leads?.length ?? 0) === 0 && campaign.audience_id) {
    const { data: leadsByAudience } = await supabase
      .from("leads")
      .select("id, name, email, status, deal_stage, company, website, archived")
      .eq("audience_id", campaign.audience_id)
      .order("name")
    leads = leadsByAudience
  }

  const leadIds = (leads ?? []).map((l) => l.id)
  const totalLeads = (leads ?? []).length
  const uniqueLeadsContacted = queueMessagesSent
  const remainingLeads = queueNotSent

  if (leadIds.length === 0) {
    return NextResponse.json({
      leads: [],
      totalLeads: 0,
      uniqueLeadsContacted,
      queueStats,
      sendingStats: {
        messagesSent: queueMessagesSent,
        failedSends: queueFailed,
        replyRate: 0,
        dailySent: dailySentToday,
        dailyLimit: DAILY_LIMIT,
      },
      replies: [],
      analytics: {
        messagesSent: queueMessagesSent,
        replies: 0,
        interestedLeads: 0,
        meetingsBooked: 0,
        replyRate: 0,
      },
      nextScheduledAt: null,
      currentPhase: "Completed",
      pendingCount: queueNotSent,
      leadsRemaining: remainingLeads,
    })
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
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
    else if (outbound) lastActivity = outbound.count === 1 ? "Message sent" : "Message sent"
    else lastActivity = "—"

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
  const analyticsReplyRate =
    queueMessagesSent > 0 ? (repliedCount / queueMessagesSent) * 100 : 0

  if (
    (campaign.status === "active" || campaign.status === "sending") &&
    queueMessagesSent > 0
  ) {
    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaignId)
  }

  return NextResponse.json({
    leads: prospects,
    queueStats,
    sendingStats: {
      messagesSent: queueMessagesSent,
      failedSends: queueFailed,
      replyRate,
      dailySent: dailySentToday,
      dailyLimit: DAILY_LIMIT,
    },
    replies: repliesList,
    analytics: {
      messagesSent: queueMessagesSent,
      replies: repliedCount,
      interestedLeads: interestedCount,
      meetingsBooked: meetingsCount,
      replyRate: analyticsReplyRate,
    },
    nextScheduledAt: null,
    currentPhase: "Completed",
    pendingCount: queueNotSent,
    totalLeads,
    uniqueLeadsContacted,
    leadsRemaining: remainingLeads,
  })
}
