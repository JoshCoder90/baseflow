"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignStatusBadge } from "./CampaignStatusBadge"
import { CampaignDetailsEditor } from "./CampaignDetailsEditor"
import { CampaignNotes } from "./CampaignNotes"
import { CampaignLeadsTable } from "./CampaignLeadsTable"
import { MessageFormatTab } from "./MessageFormatTab"
import { LeadGenerationProgress } from "./LeadGenerationProgress"
import { CampaignRepliesTab } from "./CampaignRepliesTab"
import { CampaignQueueTab, type CampaignQueueMessageRow } from "./CampaignQueueTab"
import { ScrapingProgressBar } from "./ScrapingProgressBar"
import { contactKeyForCampaignLead, MAX_LEADS_PER_CAMPAIGN } from "@/lib/campaign-leads-insert"
import type { CampaignQueueStats } from "@/lib/get-campaign-stats"

/** `/api/campaign-data` auto-refresh: queue, leads, sending stats (single interval, no overlap with a second poll). */
const CAMPAIGN_DATA_POLL_MS = 3000

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  lead_generation_status?: string | null
  /** Legacy scope when leads use `audience_id` instead of `campaign_id`. */
  audience_id?: string | null
  channel?: string | null
  audiences?: { id: string; name: string | null; niche: string | null; location: string | null; target_leads?: number | null } | null
  message_template?: string | null
  subject?: string | null
  status?: string | null
  notes?: string | null
  sent_count?: number | null
  leads?: { id: string; name: string | null; email: string | null; status?: string | null }[]
}

type Props = {
  campaign: Campaign
}

type Lead = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  website?: string | null
  status: string | null
  company: string | null
  place_id?: string | null
  /** Scheduled send time from DB (either column may be set). */
  send_at?: string | null
  next_send_at?: string | null
}

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
  if (raw.place_id !== undefined) lead.place_id = (raw.place_id as string) ?? null
  if (raw.send_at !== undefined) lead.send_at = (raw.send_at as string) ?? null
  if (raw.next_send_at !== undefined) lead.next_send_at = (raw.next_send_at as string) ?? null
  return lead
}

function getTargetLabel(campaign: Campaign): string {
  if (campaign.target_search_query) return campaign.target_search_query
  const a = campaign.audiences
  if (a) return `${a.niche || a.name || "—"} • ${a.location || "—"}`
  return campaign.target_audience ?? "—"
}

/** Match API / DB: non-null, non-empty `email` after trim. */
function leadHasNonEmptyEmail(l: Pick<Lead, "email">): boolean {
  const e = (l.email ?? "").trim()
  return e.length > 0
}

function CampaignStatsLoadingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading campaign">
      <p className="text-sm font-medium text-zinc-400">Loading campaign...</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-700/40 bg-zinc-800/30 p-5 h-[5.5rem]"
          />
        ))}
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800/80 animate-pulse" />
      <div className="flex flex-wrap gap-4">
        <div className="h-28 min-w-[140px] flex-1 rounded-xl bg-zinc-800/40 animate-pulse" />
        <div className="h-28 min-w-[140px] flex-1 rounded-xl bg-zinc-800/40 animate-pulse" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="h-6 w-44 bg-zinc-700/50 rounded mb-6 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl h-24 bg-black/30 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function CampaignDetailContent({ campaign: initialCampaign }: Props) {
  const router = useRouter()
  const campaign = initialCampaign
  const campaignId = campaign.id

  const [campaignStatus, setCampaignStatus] = useState<string | null>(
    initialCampaign.status ?? null
  )

  /** Idle until click; "starting" = HTTP in flight; "running" = success, waiting until campaign is live/completed. */
  const [startSendingUi, setStartSendingUi] = useState<"idle" | "starting" | "running">("idle")
  const [isStopping, setIsStopping] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<"message" | "leads" | "stats" | "replies" | "notes" | "queue">("stats")
  const [leadGenStatus, setLeadGenStatus] = useState<"generating" | "complete" | "failed">(
    (campaign.lead_generation_status as "generating" | "complete" | "failed") ?? "generating"
  )
  const [leadGenStage, setLeadGenStage] = useState<
    "searching" | "enriching" | "filling" | "expanding" | "complete" | null
  >(null)
  const [leadsForThisCampaign, setLeadsForThisCampaign] = useState<Lead[]>([])
  /** Outbound queue rows from `campaign_messages` (+ nested lead name/email). */
  const [queueMessages, setQueueMessages] = useState<CampaignQueueMessageRow[]>([])
  const [queueStats, setQueueStats] = useState<CampaignQueueStats>({
    sent: 0,
    notSent: 0,
    failed: 0,
  })
  const [leadsLoading, setLeadsLoading] = useState(true)
  /** True until first fetch for this campaign completes. */
  const [isLoading, setIsLoading] = useState(true)

  const activeCampaignIdRef = useRef(campaignId)
  activeCampaignIdRef.current = campaignId
  const initialFetchCompletedRef = useRef(false)

  useEffect(() => {
    setCampaignStatus(initialCampaign.status ?? null)
  }, [initialCampaign.status])

  useEffect(() => {
    if (startSendingUi !== "running") return
    const s = campaignStatus ?? campaign.status ?? "draft"
    if (s === "active" || s === "sending" || s === "completed") {
      setStartSendingUi("idle")
    }
  }, [startSendingUi, campaignStatus, campaign.status])

  /** Use live status from polling — not only SSR `campaign` props — so periodic refresh keeps UI in sync. */
  const showLeadSection =
    Boolean(campaign.target_search_query) &&
    ["generating", "complete", "failed"].includes(
      (leadGenStatus || (campaign.lead_generation_status as string) || "") as string
    )

  /**
   * Live DB snapshot: `/api/campaign-data` returns all lead rows (paginated on server).
   * Total leads / emails found = derive from `leadsForThisCampaign` only (no separate count state).
   */
  const fetchCampaignData = useCallback(async () => {
    const id = campaignId
    try {
      const res = await fetch(
        `/api/campaign-data?id=${encodeURIComponent(campaignId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) {
        console.error("fetchCampaignData: campaign-data HTTP", res.status, campaignId)
        return
      }

      const payload = (await res.json()) as {
        campaign?: {
          status?: string | null
          lead_generation_status?: string | null
          lead_generation_stage?: string | null
          target_search_query?: string | null
        }
        leads?: Record<string, unknown>[]
        queueMessages?: CampaignQueueMessageRow[]
        queueStats?: CampaignQueueStats
      }

      if (id !== activeCampaignIdRef.current) return

      const row = payload.campaign
      const leadsData = payload.leads ?? []

      if (row) {
        if (typeof row.status === "string") {
          setCampaignStatus(row.status)
        }
        const st = row.lead_generation_status as "generating" | "complete" | "failed" | undefined
        if (st === "generating" || st === "complete" || st === "failed") {
          setLeadGenStatus(st)
        }
        setLeadGenStage(
          (row.lead_generation_stage as
            | "searching"
            | "enriching"
            | "filling"
            | "expanding"
            | "complete"
            | null) ?? null
        )
      }

      setLeadsForThisCampaign(leadsData.map((raw) => normalizeLead(raw)))
      setQueueMessages(
        Array.isArray(payload.queueMessages) ? payload.queueMessages : []
      )
      const qs = payload.queueStats
      if (
        qs &&
        typeof qs.sent === "number" &&
        typeof qs.notSent === "number" &&
        typeof qs.failed === "number"
      ) {
        setQueueStats(qs)
      } else {
        setQueueStats({ sent: 0, notSent: 0, failed: 0 })
      }
    } catch (e) {
      console.error("fetchCampaignData:", e)
    } finally {
      if (id !== activeCampaignIdRef.current) return
      setLeadsLoading(false)
      if (!initialFetchCompletedRef.current) {
        initialFetchCompletedRef.current = true
        setIsLoading(false)
      }
    }
  }, [campaignId, campaign.target_search_query])

  /** Initial load + campaign switch: reset and fetch immediately (critical for live lead count). */
  useEffect(() => {
    initialFetchCompletedRef.current = false
    setIsLoading(true)
    setLeadsLoading(true)
    setLeadsForThisCampaign([])
    setQueueMessages([])
    setQueueStats({ sent: 0, notSent: 0, failed: 0 })
    void fetchCampaignData()
  }, [
    campaignId,
    initialCampaign.lead_generation_status,
    initialCampaign.target_search_query,
    fetchCampaignData,
  ])

  const fetchCampaignDataRef = useRef(fetchCampaignData)
  fetchCampaignDataRef.current = fetchCampaignData

  /**
   * Poll `/api/campaign-data` every 3s so Queue tab, stats, and lead rows update without a full page refresh.
   * Initial fetch runs in the campaign-switch effect above; this only schedules repeats and clears on unmount.
   */
  useEffect(() => {
    if (!campaignId) return
    const interval = setInterval(() => {
      void fetchCampaignDataRef.current()
    }, CAMPAIGN_DATA_POLL_MS)
    return () => clearInterval(interval)
  }, [campaignId])

  /** Refresh queue/stats when campaign_messages change (sends complete in background). */
  useEffect(() => {
    if (!campaignId) return

    const channel = supabase
      .channel(`campaign-messages-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaign_messages",
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => {
          void fetchCampaignDataRef.current()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [campaignId])

  /** Realtime: refetch when leads rows change (insert/update/delete) so stats match DB after scrape or edits. */
  useEffect(() => {
    if (!campaignId) return

    const refetch = () => {
      void fetchCampaignDataRef.current()
    }

    const ch = supabase
      .channel(`campaign-leads-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `campaign_id=eq.${campaignId}`,
        },
        refetch
      )
      .subscribe()

    const audId = campaign.audience_id
    let ch2: ReturnType<typeof supabase.channel> | null = null
    if (audId) {
      ch2 = supabase
        .channel(`campaign-leads-aud-${campaignId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "leads",
            filter: `audience_id=eq.${audId}`,
          },
          refetch
        )
        .subscribe()
    }

    return () => {
      void supabase.removeChannel(ch)
      if (ch2) void supabase.removeChannel(ch2)
    }
  }, [campaignId, campaign.audience_id])

  /** Realtime: mirror status/stage locally; one refetch when lead gen finishes (no per-tick spam). */
  useEffect(() => {
    if (!campaignId) return

    const channel = supabase
      .channel(`campaign-row-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaigns",
          filter: `id=eq.${campaignId}`,
        },
        (payload) => {
          const row = payload.new as {
            status?: string
            lead_generation_status?: string
            lead_generation_stage?: string | null
          }
          if (typeof row.status === "string") setCampaignStatus(row.status)
          const lg = row.lead_generation_status
          if (lg === "generating" || lg === "complete" || lg === "failed") {
            setLeadGenStatus(lg as "generating" | "complete" | "failed")
          }
          if (row.lead_generation_stage !== undefined) {
            setLeadGenStage(
              row.lead_generation_stage as
                | "searching"
                | "enriching"
                | "filling"
                | "expanding"
                | "complete"
                | null
            )
          }
          if (lg === "complete" || lg === "failed") {
            void fetchCampaignDataRef.current()
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [campaignId])

  const targetLabel = getTargetLabel(campaign)

  useEffect(() => {
    setLeadGenStatus(
      (campaign.lead_generation_status as "generating" | "complete" | "failed") ?? "generating"
    )
  }, [campaign.lead_generation_status])

  const handleStartSending = async () => {
    if (startSendingUi !== "idle") return
    setStartSendingUi("starting")
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start-sending`, {
        method: "POST",
      })

      await res.json()

      if (!res.ok) {
        setStartSendingUi("idle")
        return
      }

      setStartSendingUi("running")
      void fetchCampaignData()
      router.refresh()
    } catch (err) {
      console.error(err)
      setStartSendingUi("idle")
    }
  }

  const handleStopCampaign = async () => {
    try {
      setIsStopping(true)
      const res = await fetch(`/api/campaigns/${campaign.id}/stop-campaign`, {
        method: "POST",
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to stop")
      setCampaignStatus("paused")
      void fetchCampaignData()
      router.refresh()
    } catch (err) {
      console.error("Error stopping campaign:", err)
    } finally {
      setIsStopping(false)
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
            messageTemplate={campaign.message_template ?? null}
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

  const targetCap = Math.min(
    campaign.audiences?.target_leads ?? MAX_LEADS_PER_CAMPAIGN,
    MAX_LEADS_PER_CAMPAIGN
  )
  const safeLeads = Array.isArray(leadsForThisCampaign) ? leadsForThisCampaign : []
  const uniqueLeads = safeLeads.filter((lead, index, self) => {
    const key = contactKeyForCampaignLead(lead)
    return index === self.findIndex((l) => contactKeyForCampaignLead(l) === key)
  })
  /** Deduped cap for send-completion checks; headline stats use DB counts below. */
  const cappedLeads = uniqueLeads.slice(0, MAX_LEADS_PER_CAMPAIGN)

  const statsTotalLeads = safeLeads.length
  const statsEmailsFound = safeLeads.filter(leadHasNonEmptyEmail).length
  const leadsFound = statsTotalLeads

  const scrapeProgressPercent =
    targetCap > 0 ? Math.min((leadsFound / targetCap) * 100, 100) : 0
  const emailsFound = statsEmailsFound
  const isScraping = !!(showLeadSection && leadGenStatus === "generating")
  const missingEmailCount = Math.max(0, statsTotalLeads - statsEmailsFound)
  const isEnrichingUi =
    isScraping &&
    (leadGenStage === "enriching" ||
      (statsEmailsFound >= targetCap && missingEmailCount > 0))
  const emailRate =
    statsTotalLeads > 0
      ? Math.round((statsEmailsFound / statsTotalLeads) * 100)
      : 0
  const isReady = statsTotalLeads > 0 && statsEmailsFound > 0 && !isScraping
  const effectiveStatus = campaignStatus ?? campaign.status ?? "draft"
  const leadsWithEmail = cappedLeads.filter(leadHasNonEmptyEmail)
  const allEmailLeadsSent =
    leadsWithEmail.length > 0 &&
    leadsWithEmail.every((l) => l.status === "sent")
  const isCampaignCompleted =
    effectiveStatus === "completed" || allEmailLeadsSent
  const campaignIsLive =
    !isCampaignCompleted &&
    (effectiveStatus === "active" || effectiveStatus === "sending")
  const canStartOrResume =
    !isCampaignCompleted &&
    (isReady ||
      effectiveStatus === "paused" ||
      effectiveStatus === "stopped")
  const status =
    isCampaignCompleted
      ? "completed"
      : campaignIsLive
        ? "running"
        : effectiveStatus === "paused" || effectiveStatus === "stopped"
          ? "paused"
          : "draft"

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

      {/* Stat cards + progress — hidden until first fetch (no 0 flash) */}
      {isLoading ? (
        <CampaignStatsLoadingSkeleton />
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Target leads</p>
            <p className="text-xl font-semibold text-white tabular-nums">
              {targetCap}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
              Leads found
            </p>
            <p className="text-xl font-semibold text-white tabular-nums">
              {leadsFound}
              <span className="text-base font-normal text-zinc-500"> / {targetCap}</span>
            </p>
          </div>
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Status</p>
            <CampaignStatusBadge
              status={
                status === "running"
                  ? "active"
                  : status === "completed"
                    ? "completed"
                    : status
              }
            />
          </div>
        </div>

        <ScrapingProgressBar
          current={Math.min(leadsFound, targetCap)}
          target={targetCap}
          progressPercent={scrapeProgressPercent}
          statusMessage={
            showLeadSection && leadGenStatus === "generating"
              ? leadsFound < targetCap
                ? leadGenStage === "expanding"
                  ? "Expanding search to nearby areas..."
                  : leadsFound === 0
                    ? "Finding businesses and leads..."
                    : `Found ${leadsFound} leads...`
                : missingEmailCount > 0
                  ? "Finding email addresses for remaining leads..."
                  : "Scraping complete"
              : null
          }
        />

        <div className="mt-4">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 max-w-md">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-0.5">
              Email coverage
            </p>
            <p className="text-lg font-semibold text-white tabular-nums">
              Emails found: {emailsFound}
              <span className="ml-1.5 text-sm font-normal text-zinc-400">
                ({statsTotalLeads > 0 ? emailRate : 0}%)
              </span>
            </p>
            <p
              className={`text-xs mt-1 ${
                isEnrichingUi ? "text-yellow-400" : isScraping ? "text-zinc-400" : "text-green-400"
              }`}
            >
              {isEnrichingUi
                ? "Scraping emails…"
                : isScraping
                  ? leadGenStage === "expanding"
                    ? "Expanding to nearby areas…"
                    : statsEmailsFound < targetCap
                      ? "Finding businesses and emails…"
                      : "Scraping complete"
                  : "Scraping complete"}
            </p>
          </div>
        </div>

      {/* Campaign Activity */}
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">Campaign Activity</h2>
          <span
            className={`text-sm px-3 py-1 rounded-full ${
              isCampaignCompleted
                ? "bg-zinc-600/40 text-zinc-300"
                : campaignIsLive
                  ? "bg-green-500/20 text-green-400"
                  : "bg-zinc-600/40 text-zinc-400"
            }`}
          >
            {isCampaignCompleted ? "Completed" : campaignIsLive ? "Active" : "Idle"}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Sent</div>
            <div className="text-2xl font-bold text-white">{queueStats.sent}</div>
          </div>

          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Leads Total</div>
            <div className="text-2xl font-bold text-white">{statsTotalLeads}</div>
          </div>

          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Not Sent</div>
            <div className="text-2xl font-bold text-yellow-400">
              {queueStats.notSent}
            </div>
          </div>

          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Failed</div>
            <div className="text-2xl font-bold text-red-400">{queueStats.failed}</div>
          </div>

          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Status</div>
            <div
              className={`text-2xl font-bold ${
                isCampaignCompleted ? "text-zinc-300" : queueStats.sent > 0 ? "text-green-400" : "text-zinc-400"
              }`}
            >
              {isCampaignCompleted ? "Completed" : queueStats.sent > 0 ? "Sending" : "Ready"}
            </div>
          </div>
        </div>
      </div>

      {isCampaignCompleted && (
        <p className="text-sm text-zinc-300">All emails sent</p>
      )}
      {!isCampaignCompleted && queueStats.sent > 0 && (
        <p className="text-sm text-green-400">Sent {queueStats.sent} emails</p>
      )}
      {startSendingUi === "starting" && (
        <p className="text-sm text-green-400">Starting…</p>
      )}
      {startSendingUi === "running" && (
        <p className="text-sm text-green-400">Running…</p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        {campaignIsLive && (
          <button
            type="button"
            onClick={handleStopCampaign}
            disabled={isStopping}
            className="bg-red-600 px-4 py-2 rounded font-medium text-sm text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isStopping ? "Stopping…" : "Stop Campaign"}
          </button>
        )}
        {!campaignIsLive && !isCampaignCompleted && (
          <button
            type="button"
            onClick={handleStartSending}
            disabled={!canStartOrResume || startSendingUi !== "idle"}
            aria-busy={startSendingUi !== "idle"}
            className="bg-green-500 px-4 py-2 rounded font-medium text-sm text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none transition"
          >
            {startSendingUi === "starting"
              ? "Starting…"
              : startSendingUi === "running"
                ? "Running…"
                : "Start Sending Messages"}
          </button>
        )}
        {!canStartOrResume && startSendingUi === "idle" && !isCampaignCompleted && (
          <p className="text-sm text-yellow-400">Finish scraping emails before sending</p>
        )}
      </div>
        </>
      )}

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
              isGenerating={!!(showLeadSection && leadGenStatus === "generating")}
              onLeadAdded={(lead) => setLeadsForThisCampaign((prev) => [...prev, lead])}
              onLeadDeleted={(leadId) => setLeadsForThisCampaign((prev) => prev.filter((l) => l.id !== leadId))}
            />
          </div>
          <div className={activeTab === "stats" ? "block" : "hidden"}>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse">
                <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/30 p-5 h-28" />
                <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/30 p-5 h-28" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Sent</p>
                  <p className="text-2xl font-semibold text-white tabular-nums">
                    {queueStats.sent}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Reply Rate</p>
                  <p className="text-2xl font-semibold text-white tabular-nums">0%</p>
                </div>
              </div>
            )}
          </div>
          <div className={activeTab === "replies" ? "block" : "hidden"}>
            <CampaignRepliesTab
              campaignId={campaign.id}
              replies={[]}
              onUpdate={() => {}}
            />
          </div>
          <div className={activeTab === "notes" ? "block" : "hidden"}>
            <CampaignNotes campaignId={campaign.id} initialNotes={campaign.notes} />
          </div>
          <div className={activeTab === "queue" ? "block" : "hidden"}>
            <CampaignQueueTab
              queueMessages={queueMessages}
              queueStats={queueStats}
              loading={leadsLoading}
              campaignStatus={effectiveStatus}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
