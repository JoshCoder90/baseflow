"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"

type ProspectLead = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  website?: string | null
  status: string | null
  deal_stage: string | null
  company: string | null
  lastContacted: string | null
  contactStatus: string
  lastActivity: string
}

type SendingStats = {
  messagesSent: number
  initial: number
  nudge: number
  followUp: number
  final: number
  failedSends: number
  replyRate: number
}

type Reply = {
  leadId: string
  leadName: string
  company: string
  messagePreview: string
  replyStatus: string
}

type Analytics = {
  messagesSent: number
  replies: number
  interestedLeads: number
  meetingsBooked: number
  replyRate: number
}

type TabsData = {
  leads: ProspectLead[]
  sendingStats: SendingStats
  replies: Reply[]
  analytics: Analytics
}

const CONTACT_STATUS_STYLES: Record<string, string> = {
  "Not Contacted": "bg-zinc-600/60 text-zinc-300 border-zinc-500/50",
  Contacted: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Replied: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  Interested: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Closed: "bg-red-500/15 text-red-400 border-red-500/30",
}

const CARD_STYLE = "flex flex-col gap-2 rounded-2xl border p-6 text-white shadow-xl shadow-black/20 transition duration-200 hover:scale-[1.02]"

type Props = {
  campaignId: string
  /** When true, poll every 2 seconds to refresh Prospect List during lead generation */
  pollForLeads?: boolean
}

const DEFAULT_DATA: TabsData = {
  leads: [],
  sendingStats: { messagesSent: 0, initial: 0, nudge: 0, followUp: 0, final: 0, failedSends: 0, replyRate: 0 },
  replies: [],
  analytics: { messagesSent: 0, replies: 0, interestedLeads: 0, meetingsBooked: 0, replyRate: 0 },
}

export function CampaignTabs({ campaignId, pollForLeads = false }: Props) {
  const [activeTab, setActiveTab] = useState<"prospects" | "scheduled" | "sending" | "replies" | "analytics">("sending")
  const [data, setData] = useState<TabsData | null>(null)
  const [loading, setLoading] = useState(true)

  const lastFetchedCampaignId = useRef<string | null>(null)

  useEffect(() => {
    if (lastFetchedCampaignId.current === campaignId) return
    lastFetchedCampaignId.current = campaignId
    console.log("FETCH TRIGGERED")
    const fetchTabsData = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/tabs`)
        if (res.ok) {
          const json = await res.json()
          setData(json)
        } else {
          setData(DEFAULT_DATA)
        }
      } catch {
        setData(DEFAULT_DATA)
      } finally {
        setLoading(false)
      }
    }
    fetchTabsData()
  }, [campaignId])

  const tabs = [
    { id: "prospects" as const, label: "Prospect List" },
    { id: "scheduled" as const, label: "Scheduled" },
    { id: "sending" as const, label: "Sending Stats" },
    { id: "replies" as const, label: "Replies" },
    { id: "analytics" as const, label: "Analytics" },
  ]

  const d = data ?? DEFAULT_DATA

  function ContactStatusBadge({ status }: { status: string }) {
    const style = CONTACT_STATUS_STYLES[status] ?? CONTACT_STATUS_STYLES["Not Contacted"]
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>
        {status}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="mt-12 rounded-xl border border-zinc-700/60 bg-zinc-900/30 p-8 text-center">
        <p className="text-sm text-zinc-500">Loading campaign data…</p>
      </div>
    )
  }

  return (
    <div className="mt-12">
      <div className="flex gap-1 border-b border-zinc-700/60">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition ${
              activeTab === tab.id
                ? "border-b-2 border-blue-500 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-b-xl border border-t-0 border-zinc-700/60 bg-zinc-900/30 p-6">
        {activeTab === "prospects" && (
          <div className="overflow-x-auto">
            {d.leads.length === 0 ? (
              <p className="text-sm text-zinc-500">No leads yet. Create a campaign and generate leads to get started.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700/50 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                    <th className="py-3 px-4">Business Name</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">Website</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-zinc-700/30 hover:bg-zinc-800/30">
                      <td className="py-3 px-4">
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium text-white hover:text-blue-400 transition"
                        >
                          {lead.name ?? lead.company ?? "—"}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-zinc-400">
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`} className="text-blue-400 hover:underline truncate block max-w-[200px]">
                            {lead.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 px-4 text-zinc-400">{lead.phone ?? "—"}</td>
                      <td className="py-3 px-4 text-zinc-400">
                        {lead.website ? (
                          <a
                            href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline truncate block max-w-[180px]"
                          >
                            {lead.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center rounded-full border border-zinc-600/60 bg-zinc-700/40 px-2.5 py-0.5 text-xs font-medium capitalize text-zinc-300">
                          {lead.status ?? "Cold"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "scheduled" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`${CARD_STYLE} border-blue-500/20 bg-gradient-to-br from-blue-600/20 to-blue-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Initial Messages</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.initial}</p>
            </div>
            <div className={`${CARD_STYLE} border-amber-500/20 bg-gradient-to-br from-amber-600/20 to-amber-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Nudges</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.nudge}</p>
            </div>
            <div className={`${CARD_STYLE} border-purple-500/20 bg-gradient-to-br from-purple-600/20 to-purple-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Follow-Ups</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.followUp}</p>
            </div>
            <div className={`${CARD_STYLE} border-emerald-500/20 bg-gradient-to-br from-emerald-600/20 to-emerald-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Final Check-ins</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.final}</p>
            </div>
          </div>
        )}

        {activeTab === "sending" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`${CARD_STYLE} border-purple-500/20 bg-gradient-to-br from-purple-600/20 to-purple-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Messages Sent</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.messagesSent}</p>
            </div>
            <div className={`${CARD_STYLE} border-red-500/20 bg-gradient-to-br from-red-600/20 to-red-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Failed Sends</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.failedSends}</p>
            </div>
            <div className={`${CARD_STYLE} border-cyan-500/20 bg-gradient-to-br from-cyan-600/20 to-cyan-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Reply Rate</p>
              <p className="text-3xl font-semibold tabular-nums">{d.sendingStats.replyRate}%</p>
            </div>
          </div>
        )}

        {activeTab === "replies" && (
          <div className="space-y-0">
            {d.replies.length === 0 ? (
              <p className="text-sm text-zinc-500">No replies yet.</p>
            ) : (
              <div className="divide-y divide-zinc-700/50">
                {d.replies.map((r) => (
                  <Link
                    key={r.leadId}
                    href={`/dashboard/leads/${r.leadId}`}
                    className="block py-4 px-2 hover:bg-zinc-800/40 rounded-lg transition"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-white">{r.leadName}</p>
                        <p className="text-sm text-zinc-500">{r.company}</p>
                        <p className="mt-1 text-sm text-zinc-400 line-clamp-2">{r.messagePreview || "—"}</p>
                      </div>
                      <ContactStatusBadge status={r.replyStatus} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`${CARD_STYLE} border-blue-500/20 bg-gradient-to-br from-blue-600/20 to-blue-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Reply Rate</p>
              <p className="text-3xl font-semibold tabular-nums">
                {d.analytics.messagesSent > 0
                  ? `${d.analytics.replyRate.toFixed(1)}%`
                  : "0%"}
              </p>
            </div>
            <div className={`${CARD_STYLE} border-emerald-500/20 bg-gradient-to-br from-emerald-600/20 to-emerald-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Interested Leads</p>
              <p className="text-3xl font-semibold tabular-nums">{d.analytics.interestedLeads}</p>
            </div>
            <div className={`${CARD_STYLE} border-cyan-500/20 bg-gradient-to-br from-cyan-600/20 to-cyan-900/20 bg-zinc-800/60`}>
              <p className="text-sm uppercase tracking-wide text-neutral-300">Meetings Booked</p>
              <p className="text-3xl font-semibold tabular-nums">{d.analytics.meetingsBooked}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
