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

function lastNDayKeysUtc(n: number): string[] {
  const anchor = new Date()
  anchor.setUTCHours(0, 0, 0, 0)
  anchor.setUTCDate(anchor.getUTCDate() - (n - 1))
  const keys: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(anchor)
    d.setUTCDate(anchor.getUTCDate() + i)
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

function SentTrendChart({ values }: { values: number[] }) {
  const w = 560
  const h = 140
  const pad = 10
  const innerW = w - pad * 2
  const innerH = h - pad * 2
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => {
    const x =
      pad +
      (values.length <= 1 ? innerW / 2 : (i / Math.max(values.length - 1, 1)) * innerW)
    const y = pad + innerH - (v / max) * innerH
    return [x, y] as const
  })
  if (pts.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center text-sm text-zinc-500">
        No sends in this window yet
      </div>
    )
  }
  const lineD = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ")
  const first = pts[0]
  const last = pts[pts.length - 1]
  const floorY = pad + innerH
  const areaD = `${lineD} L ${last[0]} ${floorY} L ${first[0]} ${floorY} Z`

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-36 w-full min-w-0"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="bfSentTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(74 222 128)" stopOpacity="0.38" />
          <stop offset="100%" stopColor="rgb(74 222 128)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#bfSentTrendFill)" />
      <path
        d={lineD}
        fill="none"
        stroke="rgb(52 211 153)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
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
  const [sentTrend14d, setSentTrend14d] = useState<number[]>(() => Array.from({ length: 14 }, () => 0))

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
            setSentTrend14d(Array.from({ length: 14 }, () => 0))
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
            setSentTrend14d(Array.from({ length: 14 }, () => 0))
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
            setSentTrend14d(Array.from({ length: 14 }, () => 0))
          }
          return
        }

        const todayStart = startOfTodayUtcIso()
        const trendDayKeys = lastNDayKeysUtc(14)
        const trendStartIso = `${trendDayKeys[0]}T00:00:00.000Z`

        const [{ count: sentToday }, { data: leadsRows }, { data: trendRows }] = await Promise.all([
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
          supabase
            .from("campaign_messages")
            .select("sent_at")
            .in("campaign_id", campaignIds)
            .eq("status", "sent")
            .gte("sent_at", trendStartIso),
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

        const countsByDay: Record<string, number> = {}
        for (const k of trendDayKeys) countsByDay[k] = 0
        for (const row of trendRows ?? []) {
          const at = row.sent_at
          if (typeof at !== "string") continue
          const key = at.slice(0, 10)
          if (key in countsByDay) countsByDay[key]++
        }
        const trendSeries = trendDayKeys.map((k) => countsByDay[k] ?? 0)

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
          setSentTrend14d(trendSeries)
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
          setSentTrend14d(Array.from({ length: 14 }, () => 0))
        }
      }
    }

    void loadCampaignPulse()
    return () => {
      cancelled = true
    }
  }, [])

  const totalLeads = dashboardCampaigns.reduce((acc, c) => acc + (c.leads_count ?? 0), 0)
  const totalSentEver = dashboardCampaigns.reduce(
    (acc, c) => acc + (typeof c.sent_count === "number" ? c.sent_count : 0),
    0
  )
  const qualifiedPct =
    pipelineLeads > 0
      ? Math.min(100, Math.round((meetingsBooked / pipelineLeads) * 1000) / 10)
      : 0

  const chartTickIndexes = [0, 3, 6, 9, 12, 13]

  return (
    <div
      key={pathname}
      className="w-full min-h-0 px-0 py-0 md:px-2 xl:px-4"
    >
      <div className="w-full space-y-8">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[2rem]">
            Welcome back
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span className="inline-flex items-center gap-1.5 font-medium text-zinc-300">
              <svg
                className="size-4 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              Dashboard
            </span>
            <span className="text-zinc-600">·</span>
            <span>Pipeline, sends, and next actions</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/campaigns"
            className="inline-flex items-center justify-center rounded-[10px] border border-white/[0.14] bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] transition hover:border-white/25 hover:bg-white/[0.07]"
          >
            + New campaign
          </Link>
          <Link
            href="/dashboard/inbox"
            className="inline-flex items-center justify-center rounded-[10px] border border-white/[0.12] bg-black/30 px-5 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.05]"
          >
            Open inbox
          </Link>
        </div>
      </header>

      {/* Pipeline overview — hero */}
      <section
        className="bf-panel relative w-full overflow-hidden rounded-[12px] p-6 ring-1 ring-emerald-500/10"
        aria-labelledby="pipeline-overview-heading"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_100%_0%,rgba(74,222,128,0.09),transparent_55%)]" />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/25">
                <svg
                  className="size-5 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </span>
              <div>
                <h2
                  id="pipeline-overview-heading"
                  className="text-lg font-semibold tracking-tight text-white"
                >
                  Pipeline overview
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Interested + call booked across all campaigns
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/30 px-3 py-1.5 text-[11px] font-medium text-zinc-400">
              <svg
                className="size-3.5 text-zinc-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Live workspace
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Active pipeline
              </p>
              <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-emerald-400 sm:text-[2.65rem]">
                {pipelineLeads ?? 0}
              </p>
            </div>
            <div className="flex flex-wrap gap-6 text-sm lg:justify-end">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Sent today
                </p>
                <p className="mt-1 font-semibold tabular-nums text-white">
                  {emailsSentToday ?? 0}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Active campaigns
                </p>
                <p className="mt-1 font-semibold tabular-nums text-white">
                  {activeCampaigns ?? 0}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total leads", value: totalLeads },
              { label: "New replies", value: newReplies ?? 0 },
              { label: "Meetings booked", value: meetingsBooked ?? 0 },
              { label: "Leads found today", value: leadsFoundToday ?? 0 },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-[10px] border border-white/[0.07] bg-black/35 px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {tile.label}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-white">
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Messages sent (all time)
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-400">
                {totalSentEver.toLocaleString()}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 sm:self-auto">
              <svg
                className="size-3.5 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              Qualified {qualifiedPct}%
            </div>
          </div>
        </div>
      </section>

      {/* 14-day send trend */}
      <section className="bf-panel overflow-hidden rounded-[12px] ring-1 ring-white/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-400/20">
              <svg
                className="size-5 text-violet-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
                />
              </svg>
            </span>
            <div>
              <h2 className="text-base font-semibold text-white">14-day outbound trend</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Emails sent per day · all campaigns</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 text-[11px] font-medium text-zinc-500">
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]" />
            Sends
          </div>
        </div>
        <div className="px-4 pb-2 pt-4 sm:px-6">
          <SentTrendChart values={sentTrend14d} />
          <div className="mt-2 flex justify-between px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
            {chartTickIndexes.map((i) => {
              const d = new Date()
              d.setUTCHours(0, 0, 0, 0)
              d.setUTCDate(d.getUTCDate() - (13 - i))
              const label = d.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
              return (
                <span key={i} className="tabular-nums">
                  {label}
                </span>
              )
            })}
          </div>
        </div>
      </section>

      {/* Needs attention */}
      <section
        className="bf-panel relative w-full overflow-hidden rounded-[12px] p-6 ring-1 ring-amber-500/12"
        aria-labelledby="needs-attention-heading"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgba(245,158,11,0.07),transparent_55%)]" />
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
          <div className="rounded-[10px] border border-white/[0.08] bg-black/30 px-5 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              New replies
            </p>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">
              {newReplies ?? 0}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Inbound messages</p>
          </div>
          <div className="rounded-[10px] border border-white/[0.08] bg-black/30 px-5 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
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
