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
      className="w-full min-h-0 px-0 py-0 md:px-2 xl:px-4"
    >
      <div className="w-full space-y-8">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[2rem]">
            Dashboard
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-500">
            What&apos;s happening, what needs you, and what to do next.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/campaigns"
            className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.2)_inset,0_14px_40px_-18px_rgba(255,255,255,0.35)] transition hover:bg-zinc-100"
          >
            New campaign
          </Link>
          <Link
            href="/dashboard/inbox"
            className="inline-flex items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] px-5 py-2.5 text-sm font-medium text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] transition hover:border-white/20 hover:bg-white/[0.07]"
          >
            Open inbox
          </Link>
        </div>
      </header>

      {/* Needs attention — first */}
      <section
        className="bf-panel relative w-full overflow-hidden rounded-2xl p-6 ring-1 ring-amber-500/15"
        aria-labelledby="needs-attention-heading"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgba(245,158,11,0.08),transparent_55%)]" />
        <div className="relative flex items-center justify-between gap-4 pb-6">
          <h2 id="needs-attention-heading" className="text-lg font-semibold text-white">
            Needs attention
          </h2>
          <Link
            href="/dashboard/inbox"
            className="text-xs font-semibold text-amber-300/95 transition hover:text-amber-200"
          >
            View inbox →
          </Link>
        </div>
        <div className="relative grid w-full grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          <div className="rounded-xl border border-white/[0.08] bg-black/25 px-5 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              New replies
            </p>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">
              {newReplies ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Inbound messages</p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-black/25 px-5 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              In pipeline
            </p>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">
              {pipelineLeads ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Interested or call booked</p>
          </div>
        </div>
      </section>

      {/* Primary KPI row */}
      <section className="grid w-full grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
        <div className="group rounded-2xl border border-blue-500/25 bg-gradient-to-br from-blue-500/[0.12] via-blue-950/20 to-transparent p-6 transition duration-300 hover:-translate-y-0.5 hover:border-blue-400/35 hover:shadow-[0_20px_50px_-28px_rgba(59,130,246,0.45)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-white">
            {leadsFoundToday || 0}
          </p>
          <p className="text-sm text-zinc-400">Leads found today</p>
        </div>

        <div className="group rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.12] via-emerald-950/15 to-transparent p-6 transition duration-300 hover:-translate-y-0.5 hover:border-emerald-400/35 hover:shadow-[0_20px_50px_-28px_rgba(16,185,129,0.4)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-white">
            {activeCampaigns ?? 0}
          </p>
          <p className="text-sm text-zinc-400">Active campaigns</p>
        </div>

        <div className="group rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.12] via-amber-950/15 to-transparent p-6 transition duration-300 hover:-translate-y-0.5 hover:border-amber-400/35 hover:shadow-[0_20px_50px_-28px_rgba(245,158,11,0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-white">
            {meetingsBooked ?? 0}
          </p>
          <p className="text-sm text-zinc-400">Meetings booked</p>
        </div>
      </section>

      <section className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="bf-panel w-full rounded-2xl p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Active Campaigns</h3>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              <span className="bf-live-dot size-1.5 rounded-full bg-emerald-400" />
              Live sending
            </span>
          </div>

          <div className="space-y-3">
            {(dashboardCampaigns ?? []).map((campaign) => {
              const isLive =
                campaign.status === "active" || campaign.status === "sending"
              return (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-black/20 p-4 transition hover:border-white/[0.12] hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{campaign.name}</p>
                    <p className="text-xs text-zinc-500">
                      {campaign.sent_count ?? 0} sent • {campaign.leads_count ?? 0} leads
                    </p>
                  </div>

                  <div className="shrink-0">
                    {isLive ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-emerald-300">
                        <span className="bf-live-dot size-1.5 rounded-full bg-emerald-400" />
                        Sending
                      </span>
                    ) : (
                      <span className="whitespace-nowrap text-xs font-medium text-zinc-500">
                        Paused
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bf-panel overflow-hidden rounded-2xl">
          <div className="border-b border-white/[0.06] px-6 py-5">
            <h2 className="text-base font-semibold text-white">Campaign pulse</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Volume today (all campaigns)</p>
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-zinc-400">Emails sent today</span>
              <span className="font-semibold tabular-nums text-white">
                {emailsSentToday ?? 0}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="bf-panel w-full overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-white">Today&apos;s tasks</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Outcome-first — do the next right thing</p>
          </div>
          <Link
            href="/dashboard/leads"
            className="shrink-0 text-xs font-semibold text-zinc-400 transition hover:text-white"
          >
            All leads →
          </Link>
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {TODAYS_TASKS.map((task) => (
            <li key={task.title}>
              <Link
                href="/dashboard/inbox"
                className="flex flex-wrap items-start gap-4 px-6 py-4 transition hover:bg-white/[0.04] sm:flex-nowrap"
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
