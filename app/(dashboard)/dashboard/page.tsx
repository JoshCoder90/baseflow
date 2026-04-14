"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type DashboardCampaignCard = {
  id: string
  name: string
  sent_count: number | null
  status: string | null
  leads_count: number
}

type TaskOutcome = "reply" | "close" | "follow-up"

const TODAYS_TASKS: {
  outcome: TaskOutcome
  title: string
  context: string
}[] = [
  {
    outcome: "reply",
    title: "Acme Dental",
    context: "New inbound — reply soon",
  },
  {
    outcome: "close",
    title: "Summit Property Group",
    context: "Ready to move forward — propose next step or book a call",
  },
  {
    outcome: "follow-up",
    title: "Sarah Chen",
    context: "Opened last email — send a short follow-up",
  },
  {
    outcome: "reply",
    title: "Northwind Legal",
    context: "Question in thread — answer before EOD",
  },
]

const outcomeLabel: Record<TaskOutcome, string> = {
  reply: "Reply",
  close: "Close",
  "follow-up": "Follow-up",
}

const outcomeStyles: Record<TaskOutcome, string> = {
  reply: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  close: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  "follow-up": "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
}

function startOfTodayUtcIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function DashboardPage() {
  const pathname = usePathname()
  const [emailsSentToday, setEmailsSentToday] = useState(0)
  const [newReplies, setNewReplies] = useState(0)
  const [meetingsBooked, setMeetingsBooked] = useState(0)
  const [pipelineLeads, setPipelineLeads] = useState(0)
  const [activeCampaigns, setActiveCampaigns] = useState(0)
  const [leadsFoundToday, setLeadsFoundToday] = useState(0)
  const [dashboardCampaigns, setDashboardCampaigns] = useState<DashboardCampaignCard[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadCampaignPulse() {
      const safe = {
        emailsSentToday: 0,
        newReplies: 0,
        meetingsBooked: 0,
        pipelineLeads: 0,
        activeCampaigns: 0,
        leadsFoundToday: 0,
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) {
          if (!cancelled) {
            setEmailsSentToday(0)
            setNewReplies(0)
            setMeetingsBooked(0)
            setPipelineLeads(0)
            setActiveCampaigns(0)
            setLeadsFoundToday(0)
            setDashboardCampaigns([])
          }
          return
        }

        const { data: campaignRows, error: campsErr } = await supabase
          .from("campaigns")
          .select("id, name, sent_count, status")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })

        if (campsErr || cancelled) {
          if (!cancelled) {
            setEmailsSentToday(safe.emailsSentToday)
            setNewReplies(safe.newReplies)
            setMeetingsBooked(safe.meetingsBooked)
            setPipelineLeads(safe.pipelineLeads)
            setActiveCampaigns(safe.activeCampaigns)
            setLeadsFoundToday(safe.leadsFoundToday)
            setDashboardCampaigns([])
          }
          return
        }

        const campaigns = campaignRows ?? []
        const campaignIds = campaigns.map((c) => c.id).filter(Boolean)

        const leadsPerCampaign: Record<string, number> = {}

        if (campaignIds.length === 0) {
          if (!cancelled) {
            setEmailsSentToday(0)
            setNewReplies(0)
            setMeetingsBooked(0)
            setPipelineLeads(0)
            setActiveCampaigns(0)
            setLeadsFoundToday(0)
            setDashboardCampaigns([])
          }
          return
        }

        const todayStart = startOfTodayUtcIso()

        const [{ count: sentToday }, { data: leadsRows }] = await Promise.all([
          supabase
            .from("campaign_messages")
            .select("*", { count: "exact", head: true })
            .in("campaign_id", campaignIds)
            .eq("status", "sent")
            .gte("sent_at", todayStart),
          supabase
            .from("leads")
            .select("id, deal_stage, campaign_id, created_at")
            .in("campaign_id", campaignIds),
        ])

        const leads = leadsRows ?? []
        const foundToday = leads.filter((row) => {
          const at = row.created_at
          return typeof at === "string" && at >= todayStart
        }).length
        for (const row of leads) {
          const cid = row.campaign_id as string | null | undefined
          if (cid) {
            leadsPerCampaign[cid] = (leadsPerCampaign[cid] ?? 0) + 1
          }
        }

        const cards: DashboardCampaignCard[] = campaigns.map((c) => {
          const id = c.id as string
          return {
            id,
            name: typeof c.name === "string" && c.name.trim() ? c.name : "Untitled campaign",
            sent_count: typeof c.sent_count === "number" ? c.sent_count : 0,
            status: typeof c.status === "string" ? c.status : null,
            leads_count: leadsPerCampaign[id] ?? 0,
          }
        })

        const leadIds = leads.map((l) => l.id).filter(Boolean)

        let inboundTotal = 0
        if (leadIds.length > 0) {
          const { count: inboundCount, error: msgErr } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .in("lead_id", leadIds)
            .in("role", ["inbound", "lead"])
          if (!msgErr && typeof inboundCount === "number") {
            inboundTotal = inboundCount
          }
        }

        const meetings = leads.filter((l) => l.deal_stage === "Call Booked").length
        const inPipeline = leads.filter(
          (l) => l.deal_stage === "Interested" || l.deal_stage === "Call Booked"
        ).length

        const liveCampaigns = campaigns.filter(
          (c) => c.status === "active" || c.status === "sending"
        ).length

        if (!cancelled) {
          setEmailsSentToday(sentToday ?? 0)
          setNewReplies(inboundTotal)
          setMeetingsBooked(meetings)
          setPipelineLeads(inPipeline)
          setActiveCampaigns(liveCampaigns)
          setLeadsFoundToday(foundToday)
          setDashboardCampaigns(cards)
        }
      } catch {
        if (!cancelled) {
          setEmailsSentToday(safe.emailsSentToday)
          setNewReplies(safe.newReplies)
          setMeetingsBooked(safe.meetingsBooked)
          setPipelineLeads(safe.pipelineLeads)
          setActiveCampaigns(safe.activeCampaigns)
          setLeadsFoundToday(safe.leadsFoundToday)
          setDashboardCampaigns([])
        }
      }
    }

    void loadCampaignPulse()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      key={pathname}
      className="w-full min-h-screen bg-black px-6 md:px-8 xl:px-12 py-6"
    >
      <div className="w-full space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="text-zinc-500 mt-1.5 text-sm">
            What&apos;s happening, what needs you, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/campaigns"
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 transition"
          >
            New campaign
          </Link>
          <Link
            href="/dashboard/inbox"
            className="rounded-full border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition"
          >
            Open inbox
          </Link>
        </div>
      </header>

      {/* Needs attention — first */}
      <section
        className="w-full rounded-2xl border border-orange-500/20 p-6"
        aria-labelledby="needs-attention-heading"
      >
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 id="needs-attention-heading" className="text-lg font-semibold text-white">
            Needs attention
          </h2>
          <Link
            href="/dashboard/inbox"
            className="text-xs font-medium text-amber-400/90 hover:text-amber-300 transition"
          >
            View inbox →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          <div className="rounded-xl bg-black/20 border border-white/5 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              New replies
            </p>
            <p className="text-3xl font-semibold tabular-nums text-white">
              {newReplies ?? 0}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Inbound messages</p>
          </div>
          <div className="rounded-xl bg-black/20 border border-white/5 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              In pipeline
            </p>
            <p className="text-3xl font-semibold tabular-nums text-white">
              {pipelineLeads ?? 0}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Interested or call booked</p>
          </div>
        </div>
      </section>

      {/* Primary KPI row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
        <div className="rounded-2xl p-6 bg-gradient-to-br from-blue-500/10 to-blue-900/10 border border-blue-500/20">
          <p className="text-2xl font-semibold tabular-nums text-white">
            {leadsFoundToday || 0}
          </p>
          <p className="text-sm text-gray-400">Leads found today</p>
        </div>

        <div className="rounded-2xl p-6 bg-gradient-to-br from-green-500/10 to-green-900/10 border border-green-500/20">
          <p className="text-2xl font-semibold tabular-nums text-white">
            {activeCampaigns ?? 0}
          </p>
          <p className="text-sm text-gray-400">Active campaigns</p>
        </div>

        <div className="rounded-2xl p-6 bg-gradient-to-br from-yellow-500/10 to-yellow-900/10 border border-yellow-500/20">
          <p className="text-2xl font-semibold tabular-nums text-white">
            {meetingsBooked ?? 0}
          </p>
          <p className="text-sm text-gray-400">Meetings booked</p>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        <div className="w-full rounded-2xl border border-white/10 p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-white">Active Campaigns</h3>
            <span className="text-xs text-gray-400">Live sending</span>
          </div>

          <div className="space-y-4">
            {(dashboardCampaigns ?? []).map((campaign) => {
              const isLive =
                campaign.status === "active" || campaign.status === "sending"
              return (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/5 border border-white/10"
                >
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{campaign.name}</p>
                    <p className="text-xs text-gray-400">
                      {campaign.sent_count ?? 0} sent • {campaign.leads_count ?? 0} leads
                    </p>
                  </div>

                  <div className="shrink-0">
                    {isLive ? (
                      <span className="text-green-400 text-xs whitespace-nowrap">
                        ● Sending
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs whitespace-nowrap">
                        Paused
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="px-6 py-5 border-b border-zinc-800/80">
            <h2 className="text-base font-semibold text-white">Campaign pulse</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Volume today (all campaigns)</p>
          </div>
          <div className="px-6 py-5">
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-zinc-400">Emails sent today</span>
              <span className="text-white font-medium tabular-nums">
                {emailsSentToday ?? 0}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        <div className="px-6 py-5 border-b border-zinc-800/80 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Today&apos;s tasks</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Outcome-first — do the next right thing</p>
          </div>
          <Link
            href="/dashboard/leads"
            className="text-xs font-medium text-zinc-400 hover:text-white transition shrink-0"
          >
            All leads →
          </Link>
        </div>
        <ul className="divide-y divide-zinc-800/80">
          {TODAYS_TASKS.map((task) => (
            <li key={task.title}>
              <Link
                href="/dashboard/inbox"
                className="flex items-start gap-4 px-6 py-4 hover:bg-zinc-800/30 transition flex-wrap sm:flex-nowrap"
              >
                <span
                  className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${outcomeStyles[task.outcome]}`}
                >
                  {outcomeLabel[task.outcome]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{task.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{task.context}</p>
                </div>
                <span className="text-zinc-600 text-sm shrink-0 hidden sm:inline">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      </div>
    </div>
  )
}
