"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignStatusBadge } from "./CampaignStatusBadge"
import { CampaignDetailsEditor } from "./CampaignDetailsEditor"
import { CampaignNotes } from "./CampaignNotes"
import { CampaignLeadsTable } from "./CampaignLeadsTable"
import { MessageFormatTab } from "./MessageFormatTab"
import { LeadGenerationProgress } from "./LeadGenerationProgress"
import { CampaignActivity } from "./CampaignActivity"
import { CampaignRepliesTab } from "./CampaignRepliesTab"
import { CampaignQueueTab } from "./CampaignQueueTab"
import { ScrapingProgressBar } from "./ScrapingProgressBar"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  lead_generation_status?: string | null
  audience_id?: string | null
  channel?: string | null
  audiences?: { id: string; name: string | null; niche: string | null; location: string | null; target_leads?: number | null } | null
  message_template?: string | null
  follow_up_schedule?: string | null
  subject?: string | null
  status?: string | null
  notes?: string | null
}

type Props = {
  campaign: Campaign
  leadCount?: number
}

type Lead = { id: string; name: string | null; phone: string | null; email: string | null; website?: string | null; status: string | null; company: string | null }

function normalizeLead(raw: Record<string, unknown>): Lead {
  const lead: Lead = {
    id: String(raw.id ?? ""),
    name: (raw.name as string) ?? null,
    phone: (raw.phone as string) ?? null,
    email: (raw.email as string) ?? null,
    status: (raw.status as string) ?? null,
    company: (raw.company as string) ?? null,
  }
  if (raw.website !== undefined) lead.website = (raw.website as string) ?? null
  return lead
}

function getTargetLabel(campaign: Campaign): string {
  if (campaign.target_search_query) return campaign.target_search_query
  const a = campaign.audiences
  if (a) return `${a.niche || a.name || "—"} • ${a.location || "—"}`
  return campaign.target_audience ?? "—"
}

export function CampaignDetailContent({ campaign, leadCount }: Props) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState<"draft" | "running" | "paused">(
    (campaign.status === "active" ? "running" : campaign.status === "paused" || campaign.status === "stopped" ? "paused" : "draft") as "draft" | "running" | "paused"
  )
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<"message" | "leads" | "stats" | "replies" | "notes" | "queue">("stats")
  const [leadGenStatus, setLeadGenStatus] = useState<"generating" | "complete" | "failed">(
    (campaign.lead_generation_status as "generating" | "complete" | "failed") ?? "generating"
  )
  const [leadGenStage, setLeadGenStage] = useState<"searching" | "enriching" | "complete" | null>(
    null
  )

  const [leadsForThisCampaign, setLeadsForThisCampaign] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [tabsData, setTabsData] = useState<{
    sendingStats: { messagesSent: number; failedSends: number; replyRate: number; dailySent?: number; dailyLimit?: number }
    replies: {
      leadId: string
      leadName: string
      company: string
      messagePreview: string
      messageContent: string
      createdAt: string
      replyStatus: string
    }[]
    repliesCount: number
    nextScheduledAt: string | null
    currentPhase: string
    pendingCount?: number
    uniqueLeadsContacted: number
    leadsRemaining: number
  } | null>(null)

  const showLeadSection =
    campaign.target_search_query &&
    ["generating", "complete", "failed"].includes(
      campaign.lead_generation_status ?? ""
    )

  const showActivity = status === "running" || status === "paused"

  const campaignId = campaign.id
  const fetchTabsDataRef = useRef<() => void>(() => {})
  const fetchLeadsRef = useRef<() => void>(() => {})
  const lastFetchedCampaignId = useRef<string | null>(null)
  const isFetching = useRef(false)

  useEffect(() => {
    const fetchLeads = async () => {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("campaign_id", campaignId)
      if (data) {
        if (data.length > 0) setLeadsForThisCampaign(data)
      }
      setLeadsLoading(false)
    }
    fetchLeadsRef.current = fetchLeads
    fetchLeads()
  }, [campaignId])

  useEffect(() => {
    if (!showLeadSection || leadGenStatus !== "generating") return

    const interval = setInterval(() => {
      fetchLeadsRef.current?.()
    }, 3000)
    return () => clearInterval(interval)
  }, [campaignId, showLeadSection, leadGenStatus])

  useEffect(() => {
    if (lastFetchedCampaignId.current === campaignId) return
    lastFetchedCampaignId.current = campaignId
    const fetchTabsData = async () => {
      if (isFetching.current) return
      isFetching.current = true
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/tabs`)
        if (res.ok) {
          const json = await res.json()
          if (
            (json.pendingCount ?? 0) === 0 &&
            (json.sendingStats?.messagesSent ?? 0) > 0 &&
            (campaign?.status === "active" || campaign?.status === "sending")
          ) {
            router.refresh()
          }
          setTabsData({
            sendingStats: { messagesSent: 0, failedSends: 0, replyRate: 0, dailySent: 0, dailyLimit: 100, ...json.sendingStats },
            replies: json.replies ?? [],
            repliesCount: json.analytics?.replies ?? json.replies?.length ?? 0,
            nextScheduledAt: json.nextScheduledAt ?? null,
            currentPhase: json.currentPhase ?? "Initial Messages",
            pendingCount: json.pendingCount ?? 0,
            uniqueLeadsContacted: json.uniqueLeadsContacted ?? 0,
            leadsRemaining: json.leadsRemaining ?? 0,
          })
        }
      } catch {
        // ignore
      } finally {
        isFetching.current = false
      }
    }
    fetchTabsDataRef.current = () => { fetchTabsData() }
    fetchTabsData()
  }, [campaignId])

  useEffect(() => {
    if (status !== "running" && campaign?.status !== "active" && campaign?.status !== "sending") return
    const interval = setInterval(() => {
      fetchTabsDataRef.current?.()
    }, 3000)
    return () => clearInterval(interval)
  }, [status, campaign?.status])

  useEffect(() => {
    if (!campaignId) return

    const channel = supabase
      .channel(`leads-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "leads",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          console.log("REALTIME INSERT:", payload.new)
          const raw = payload.new as Record<string, unknown>
          const newLead = normalizeLead(raw)
          setLeadsForThisCampaign((prev) => {
            const exists = prev.find((l) => l.id === newLead.id)
            if (exists) return prev
            return [...prev, newLead]
          })
          setTick((t) => t + 1)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          const updated = payload.new as Record<string, unknown>
          setLeadsForThisCampaign((prev) => {
            const idx = prev.findIndex((l) => l.id === updated.id)
            if (idx >= 0) {
              return prev.map((l) => {
                if (l.id !== updated.id) return l
                return normalizeLead({ ...l, ...updated })
              })
            }
            return [...prev, normalizeLead(updated)]
          })
          setTick((t) => t + 1)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  const targetLabel = getTargetLabel(campaign)

  useEffect(() => {
    setLeadGenStatus(
      (campaign.lead_generation_status as "generating" | "complete" | "failed") ?? "generating"
    )
  }, [campaign.lead_generation_status])

  useEffect(() => {
    const s = campaign.status ?? "draft"
    setStatus((s === "active" || s === "sending" ? "running" : s === "paused" || s === "stopped" || s === "completed" ? "paused" : "draft") as "draft" | "running" | "paused")
  }, [campaign.status])

  const handleStart = async () => {
    if (status === "running") return
    const prevStatus = status
    console.log("Start button clicked, campaign:", campaign.id)
    setIsLoading(true)
    setStatus("running")
    try {
      const res = await fetch("/api/start-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id }),
      })
      const data = await res.json()
      console.log("Start campaign response:", data)
      if (!res.ok) throw new Error(data.error ?? "Failed to start")
      router.refresh()
      fetchTabsDataRef.current?.()
    } catch (err) {
      console.error("Error starting campaign:", err)
      setStatus(prevStatus)
    } finally {
      setIsLoading(false)
    }
  }

  const handleStop = async () => {
    console.log("Stop button clicked, campaign:", campaign.id)
    setStatus("paused")
    try {
      const res = await fetch("/api/stop-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id }),
      })
      const data = await res.json()
      console.log("Stop campaign response:", data)
      if (!res.ok) throw new Error(data.error ?? "Failed to stop")
      router.refresh()
      fetchTabsDataRef.current?.()
    } catch (err) {
      console.error("Error stopping campaign:", err)
    }
  }

  if (isEditing) {
    return (
      <div className="space-y-8">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
            Edit campaign
          </h2>
          <CampaignDetailsEditor
            campaignId={campaign.id}
            channel={campaign.channel}
            messageTemplate={campaign.message_template ?? null}
            followUpSchedule={campaign.follow_up_schedule ?? null}
            subject={campaign.subject ?? null}
            targetAudience={targetLabel}
            audienceNiche={campaign.audiences?.niche ?? campaign.audiences?.name ?? campaign.target_search_query ?? campaign.target_audience ?? undefined}
            onCancel={() => setIsEditing(false)}
            onSaved={() => {
              setIsEditing(false)
              router.refresh()
            }}
            editMode
          />
        </div>
      </div>
    )
  }

  const leads = leadsForThisCampaign ?? []
  const emailsFound = leads.filter((l) => l.email).length
  const isScraping = !!(showLeadSection && leadGenStatus === "generating")
  const isReady = leads.length > 0 && emailsFound > 0 && !isScraping

  return (
    <div className="space-y-6">
      {/* Lead gen: triggers API + Realtime for status (invisible) */}
      {showLeadSection && (
        <LeadGenerationProgress
          campaignId={campaign.id}
          targetSearchQuery={campaign.target_search_query!}
          initialStatus={
            (campaign.lead_generation_status as "generating" | "complete" | "failed") ??
            "generating"
          }
          onStatusChange={setLeadGenStatus}
          onStageChange={setLeadGenStage}
        />
      )}

      {/* Stat cards + Progress: ONE source = leadsForThisCampaign (updates live via Realtime) */}
      {(() => {
        const targetLeads = campaign.audiences?.target_leads ?? 200
        const leads = leadsForThisCampaign
        const displayLeads = Math.min(leads.length, targetLeads)
        const emailCount = leads.filter((l) => l.email).length
        const phoneCount = leads.filter((l) => l.phone).length
        const emailRate = leads.length ? Math.round((emailCount / leads.length) * 100) : 0
        const phoneRate = leads.length ? Math.round((phoneCount / leads.length) * 100) : 0
        const isScraping = showLeadSection && leadGenStatus === "generating"
        const scrapingStatus = isScraping ? "Scraping contact info..." : "Scraping complete"
        return (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Target Leads</p>
          <p className="text-xl font-semibold text-white tabular-nums">
            {targetLeads}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Leads Found</p>
          <p className="text-xl font-semibold text-white tabular-nums">
            {displayLeads}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Status</p>
          <CampaignStatusBadge status={status === "running" ? "active" : status} />
        </div>
      </div>

      {/* Progress bar: same leads array as Leads tab (displayLeads prevents overflow) */}
      <ScrapingProgressBar
        current={displayLeads}
        target={targetLeads}
        statusMessage={
          showLeadSection && leadGenStatus === "generating"
            ? leadGenStage === "enriching"
              ? "Finding lead information..."
              : leads.length === 0
                ? "Finding businesses..."
                : null
            : null
        }
      />

      {/* Email + phone metrics from existing leads (updates live) */}
      <div className="flex flex-wrap gap-4 mt-4">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 min-w-[140px]">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-0.5">Emails Found</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {emailCount}
            {leads.length > 0 && (
              <span className="ml-1.5 text-sm font-normal text-zinc-400">({emailRate}%)</span>
            )}
          </p>
          <p className={`text-xs mt-1 ${isScraping ? "text-yellow-400" : "text-green-400"}`}>
            {scrapingStatus}
          </p>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 min-w-[140px]">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-0.5">Phone Numbers</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {phoneCount}
            {leads.length > 0 && (
              <span className="ml-1.5 text-sm font-normal text-zinc-400">({phoneRate}%)</span>
            )}
          </p>
          <p className={`text-xs mt-1 ${isScraping ? "text-yellow-400" : "text-green-400"}`}>
            {scrapingStatus}
          </p>
        </div>
      </div>
      </>
        )
      })()}

      {/* Campaign Activity - when active or paused */}
      {showActivity && tabsData && (
        <CampaignActivity
          status={
            status === "running" && (tabsData.pendingCount ?? 0) === 0
              ? "completed"
              : status === "running"
                ? "active"
                : status
          }
          currentPhase={
            status === "running"
              ? (tabsData.pendingCount ?? 0) === 0
                ? "Completed"
                : "Sending..."
              : status === "paused"
                ? "Paused"
                : campaign.status === "completed"
                  ? "Completed"
                  : tabsData.currentPhase
          }
          messagesSent={tabsData.sendingStats.messagesSent}
          repliesCount={tabsData.repliesCount}
          nextScheduledAt={tabsData.nextScheduledAt}
          leadsRemaining={tabsData.leadsRemaining}
        />
      )}

      {/* Status text */}
      {status === "running" && (
        <p className="text-sm text-green-400">
          {(tabsData?.pendingCount ?? 0) === 0 ? "Completed" : "Sending..."}
        </p>
      )}
      {status === "paused" && <p className="text-sm text-yellow-400">Paused — click Resume to continue</p>}
      {status === "draft" && <p className="text-sm text-zinc-500">Ready to start</p>}
      {tabsData?.sendingStats?.dailyLimit != null && (
        <p className="text-sm text-zinc-400">
          You&apos;ve sent {tabsData.sendingStats.dailySent ?? 0} / {tabsData.sendingStats.dailyLimit} emails today
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        {status === "running" && (tabsData?.pendingCount ?? 1) > 0 ? (
          <button
            type="button"
            onClick={handleStop}
            disabled={isLoading}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded font-medium text-sm transition disabled:opacity-50"
          >
            Stop Sending
          </button>
        ) : status === "running" && tabsData && (tabsData.pendingCount ?? 0) === 0 ? (
          <p className="text-sm text-zinc-400">Campaign completed</p>
        ) : (
          <>
            <button
              type="button"
              onClick={handleStart}
              disabled={isLoading || (!isReady && status === "draft")}
              className={`px-4 py-2 rounded font-medium text-sm transition ${
                isReady || status === "paused"
                  ? "bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
                  : "bg-zinc-600 text-zinc-400 cursor-not-allowed opacity-50"
              }`}
            >
              {isLoading
                ? status === "paused"
                  ? "Resuming…"
                  : "Starting…"
                : status === "paused"
                  ? "Resume Campaign"
                  : "Start Sending Messages"}
            </button>
            {!isReady && status === "draft" && (
              <p className="text-sm text-yellow-400 mt-1 ml-1">
                Finish scraping emails before sending
              </p>
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/30 overflow-hidden">
        <div className="flex gap-1 border-b border-zinc-700/60 p-1">
          {[
            { id: "message" as const, label: "Message Format" },
            { id: "leads" as const, label: "Leads" },
            { id: "stats" as const, label: "Sending Stats" },
            { id: "replies" as const, label: "Replies" },
            { id: "notes" as const, label: "Notes" },
            { id: "queue" as const, label: "Queue" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "bg-zinc-800 text-white rounded-lg"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="p-6">
          <div className={activeTab === "message" ? "block" : "hidden"}>
            <MessageFormatTab
              campaign={campaign}
              targetLabel={targetLabel}
              onSaved={() => router.refresh()}
            />
          </div>
          <div className={activeTab === "leads" ? "block" : "hidden"}>
            <CampaignLeadsTable
              campaignId={campaign.id}
              leads={leadsForThisCampaign}
              loading={leadsLoading}
              targetLeads={campaign.audiences?.target_leads ?? 200}
              isGenerating={!!(showLeadSection && leadGenStatus === "generating")}
              onLeadAdded={(lead) => setLeadsForThisCampaign((prev) => [...prev, lead])}
              onLeadDeleted={(leadId) => setLeadsForThisCampaign((prev) => prev.filter((l) => l.id !== leadId))}
            />
          </div>
          <div className={activeTab === "stats" ? "block" : "hidden"}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Messages Sent</p>
                <p className="text-2xl font-semibold text-white tabular-nums">
                  {tabsData?.sendingStats.messagesSent ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Failed Sends</p>
                <p className="text-2xl font-semibold text-white tabular-nums">
                  {tabsData?.sendingStats.failedSends ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Reply Rate</p>
                <p className="text-2xl font-semibold text-white tabular-nums">
                  {tabsData?.sendingStats.replyRate ?? 0}%
                </p>
              </div>
            </div>
          </div>
          <div className={activeTab === "replies" ? "block" : "hidden"}>
            <CampaignRepliesTab
              campaignId={campaign.id}
              replies={tabsData?.replies ?? []}
              onUpdate={() => fetchTabsDataRef.current?.()}
            />
          </div>
          <div className={activeTab === "notes" ? "block" : "hidden"}>
            <CampaignNotes campaignId={campaign.id} initialNotes={campaign.notes} />
          </div>
          <div className={activeTab === "queue" ? "block" : "hidden"}>
            <CampaignQueueTab
              campaignId={campaign.id}
              activeTab={activeTab}
              campaignStatus={campaign.status ?? undefined}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
