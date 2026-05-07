"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignDetailsEditor } from "./CampaignDetailsEditor"
import { CampaignNotes } from "./CampaignNotes"
import { CampaignLeadsTable } from "./CampaignLeadsTable"
import { MessageFormatTab } from "./MessageFormatTab"
import { CampaignRepliesTab } from "./CampaignRepliesTab"
import { CampaignQueueTab, type CampaignQueueMessageRow } from "./CampaignQueueTab"
import { ScrapingProgressBar } from "./ScrapingProgressBar"
import { MAX_LEADS_PER_CAMPAIGN } from "@/lib/campaign-leads-insert"
import type { CampaignQueueStats } from "@/lib/get-campaign-stats"
import { getCampaignStats } from "@/lib/get-campaign-stats"
import {
  applyInboundReplyToLeadStatus,
  fetchLeadIdsWithInboundMessages,
} from "@/lib/lead-inbound-reply-status"

/** While scraping, backup poll so UI stays in sync if Realtime lags or events batch. */
const SCRAPE_PROGRESS_POLL_MS = 1200
/** Debounce full refetch after Realtime bursts — avoids out-of-order HTTP responses overwriting newer lead counts. */
const LEADS_REALTIME_REFETCH_DEBOUNCE_MS = 450
const LEADS_PAGE = 1000

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  target_search_query?: string | null
  leads_found?: number | null
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
  /** When true (e.g. redirect from “Find emails” on create), run scrape loop once without an extra click. */
  autoStartScrape?: boolean
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

/** Same scoping and shapes as the former `/api/campaign-data` route; uses browser Supabase + RLS. */
async function loadLeadsAndQueueFromClient(
  campaignId: string,
  audienceId: string | null
): Promise<{
  leads: Lead[]
  queueMessages: CampaignQueueMessageRow[]
  queueStats: CampaignQueueStats
} | null> {
  const { data: probe } = await supabase
    .from("leads")
    .select("id")
    .eq("campaign_id", campaignId)
    .limit(1)
  const hasCampaignLeads = (probe ?? []).length > 0
  const scope: "campaign" | "audience" =
    hasCampaignLeads ? "campaign" : audienceId ? "audience" : "campaign"

  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += LEADS_PAGE) {
    const to = from + LEADS_PAGE - 1
    let q = supabase
      .from("leads")
      .select("*")
      .order("id", { ascending: true })
      .range(from, to)
    if (scope === "campaign") q = q.eq("campaign_id", campaignId)
    else if (audienceId) q = q.eq("audience_id", audienceId)
    else q = q.eq("campaign_id", campaignId)
    const { data, error } = await q
    if (error) {
      console.error("[loadLeadsAndQueueFromClient] leads", error)
      return null
    }
    const chunk = (data ?? []) as (Record<string, unknown> & { phone?: unknown })[]
    for (const row of chunk) {
      const { phone: _omit, ...rest } = row
      rows.push(rest)
    }
    if (chunk.length < LEADS_PAGE) break
  }

  const { data: queuedMessages, error: qErr } = await supabase
    .from("campaign_messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "pending", "sending"])
    .order("created_at", { ascending: true })

  console.log("QUEUE DATA:", queuedMessages)

  if (!queuedMessages?.length) {
    const { data: queueDebugNoStatusFilter } = await supabase
      .from("campaign_messages")
      .select("id, lead_id, status, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
    console.log("QUEUE DEBUG (no status filter):", queueDebugNoStatusFilter)
  }

  if (qErr) {
    console.error("[loadLeadsAndQueueFromClient] campaign_messages", qErr)
  }
  const knownLeadIds = new Set(rows.map((r) => String(r.id)))
  const queueListSafe = (
    (queuedMessages ?? []) as Record<string, unknown>[]
  ).filter((m) => knownLeadIds.has(String(m.lead_id ?? "")))
  const leadIds = [
    ...new Set(
      queueListSafe
        .map((m) => m.lead_id as string | undefined)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ]

  let queueMessages: CampaignQueueMessageRow[] = []
  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from("leads")
      .select("id, name, email")
      .in("id", leadIds)
    const leadMap = new Map(
      (leadRows ?? []).map((l) => [l.id as string, l as { name: string | null; email: string | null }])
    )
    queueMessages = queueListSafe.map((m) => {
      const lid = m.lead_id as string
      const L = leadMap.get(lid)
      return {
        ...m,
        leads: L ? { name: L.name, email: L.email } : null,
      } as unknown as CampaignQueueMessageRow
    })
  } else {
    queueMessages = queueListSafe as unknown as CampaignQueueMessageRow[]
  }

  const queueStatsFromDb = await getCampaignStats(supabase, campaignId)
  const leadsTotalCount = rows.length
  const notSent = Math.max(0, leadsTotalCount - queueStatsFromDb.sent)

  const leadIdsForInbound = rows.map((r) => String(r.id ?? "")).filter(Boolean)
  const inboundLeadIds = await fetchLeadIdsWithInboundMessages(supabase, leadIdsForInbound)
  const rowsWithReplyStatus = rows.map((raw) => {
    const id = String(raw.id ?? "")
    const cur = (raw.status as string | null) ?? null
    const merged = applyInboundReplyToLeadStatus({ id, status: cur }, inboundLeadIds)
    if (merged.status === cur) return raw
    return { ...raw, status: merged.status }
  })

  return {
    leads: rowsWithReplyStatus.map((raw) => normalizeLead(raw)),
    queueMessages,
    queueStats: { ...queueStatsFromDb, notSent },
  }
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

export function CampaignDetailContent({
  campaign: initialCampaign,
  autoStartScrape = false,
}: Props) {
  const router = useRouter()
  const [apiPatch, setApiPatch] = useState<Partial<Campaign> | null>(null)
  /** Live `campaigns` row fields from `/api/get-campaign` + Realtime (single source for UI). */
  const [liveCampaign, setLiveCampaign] = useState<{
    status: string | null
    leads_found: number | null
  }>({
    status: initialCampaign.status ?? null,
    leads_found:
      typeof initialCampaign.leads_found === "number" ? initialCampaign.leads_found : null,
  })
  const campaign = { ...initialCampaign, ...apiPatch } as Campaign
  const campaignId = campaign.id
  const statusRef = useRef<string | null>(null)
  statusRef.current = (liveCampaign.status ?? campaign.status ?? null) as string | null

  useEffect(() => {
    setApiPatch(null)
  }, [campaignId])

  useEffect(() => {
    autoScrapeMemoryLockRef.current = false
  }, [campaignId])

  /** Idle until click; "starting" = HTTP in flight; "awaiting_active" = OK, waiting until campaign is live/completed. */
  const [startSendingUi, setStartSendingUi] = useState<
    "idle" | "starting" | "awaiting_active"
  >("idle")
  const [scrapeUi, setScrapeUi] = useState<"idle" | "running">("idle")
  /** When `sessionStorage` is unavailable, prevents React Strict Mode from starting two scrapes. */
  const autoScrapeMemoryLockRef = useRef(false)
  const [isStopping, setIsStopping] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<"message" | "leads" | "stats" | "replies" | "notes" | "queue">("stats")
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
  /** For `messages` Realtime: refetch campaign leads when an inbound row lands for any lead on this campaign. */
  const leadIdsForRealtimeRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setLiveCampaign({
      status: initialCampaign.status ?? null,
      leads_found:
        typeof initialCampaign.leads_found === "number" ? initialCampaign.leads_found : null,
    })
  }, [campaignId, initialCampaign.status, initialCampaign.leads_found])

  useEffect(() => {
    leadIdsForRealtimeRef.current = new Set(
      leadsForThisCampaign.map((l) => l.id).filter((id) => id.length > 0)
    )
  }, [leadsForThisCampaign])

  useEffect(() => {
    if (startSendingUi !== "awaiting_active") return
    const s = (liveCampaign.status ?? campaign.status ?? "draft").toLowerCase()
    if (s === "active" || s === "sending") {
      setStartSendingUi("idle")
    }
  }, [startSendingUi, liveCampaign.status, campaign.status])

  /** Natural-language lead search: show stats/scrape UI whenever the campaign has a target query. */
  const showLeadSection = Boolean(campaign.target_search_query)

  /**
   * Live DB snapshot: GET `/api/get-campaign` for the row; leads + queue via Supabase (same data as former `campaign-data`).
   * Total leads / emails found = derive from `leadsForThisCampaign` only (no separate count state).
   */
  const fetchCampaignData = useCallback(async () => {
    const id = campaignId
    try {
      await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/cleanup-queue`, {
        method: "POST",
      }).catch(() => {
        /* non-fatal */
      })

      const res = await fetch(
        `/api/get-campaign?id=${encodeURIComponent(campaignId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) return

      const data = (await res.json()) as Record<string, unknown> & {
        id?: string
        status?: string | null
        leads_found?: number | null
        audience_id?: string | null
      }
      if (id !== activeCampaignIdRef.current) return
      if (!data.id) return

      const { body: _b, error: _err, ...row } = data
      setApiPatch((p) => ({ ...p, ...(row as unknown as Partial<Campaign>) }))

      const st = row.status
      const lf = row.leads_found
      setLiveCampaign((prev) => ({
        status: typeof st === "string" ? st : prev.status,
        leads_found:
          typeof lf === "number"
            ? lf
            : lf != null && !Number.isNaN(Number(lf))
              ? Number(lf)
              : prev.leads_found,
      }))

      const audId =
        row.audience_id != null && row.audience_id !== ""
          ? String(row.audience_id)
          : null
      const loaded = await loadLeadsAndQueueFromClient(campaignId, audId)
      if (id !== activeCampaignIdRef.current) return
      if (loaded) {
        setLeadsForThisCampaign(loaded.leads)
        setQueueMessages(loaded.queueMessages)
        setQueueStats(loaded.queueStats)
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
    initialCampaign.target_search_query,
    fetchCampaignData,
  ])

  const fetchCampaignDataRef = useRef(fetchCampaignData)
  fetchCampaignDataRef.current = fetchCampaignData

  const leadsRealtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleDebouncedFullCampaignFetch = useCallback(() => {
    if (leadsRealtimeDebounceRef.current) clearTimeout(leadsRealtimeDebounceRef.current)
    leadsRealtimeDebounceRef.current = setTimeout(() => {
      leadsRealtimeDebounceRef.current = null
      void fetchCampaignDataRef.current()
    }, LEADS_REALTIME_REFETCH_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (leadsRealtimeDebounceRef.current) clearTimeout(leadsRealtimeDebounceRef.current)
    }
  }, [])

  /** Apply Realtime row immediately so counts/progress update every lead; debounced full sync avoids races. */
  const applyLeadRealtimePayload = useCallback(
    (
      payload: {
        eventType: string
        new: Record<string, unknown> | null
        old: Record<string, unknown> | null
      },
      scope: "campaign" | "audience",
      audienceIdForScope: string | null
    ) => {
      const ev = payload.eventType
      if (ev === "INSERT" && payload.new) {
        const row = payload.new
        if (scope === "campaign") {
          if (String(row.campaign_id ?? "") !== campaignId) return
        } else if (!audienceIdForScope || String(row.audience_id ?? "") !== audienceIdForScope) {
          return
        }
        setLeadsForThisCampaign((prev) => {
          const id = String(row.id ?? "")
          if (!id || prev.some((l) => l.id === id)) return prev
          return [...prev, normalizeLead(row)]
        })
      } else if (ev === "UPDATE" && payload.new) {
        const row = payload.new
        if (scope === "campaign") {
          if (String(row.campaign_id ?? "") !== campaignId) return
        } else if (!audienceIdForScope || String(row.audience_id ?? "") !== audienceIdForScope) {
          return
        }
        setLeadsForThisCampaign((prev) => {
          const id = String(row.id ?? "")
          if (!id) return prev
          const next = normalizeLead(row)
          const idx = prev.findIndex((l) => l.id === id)
          if (idx === -1) return [...prev, next]
          const copy = [...prev]
          copy[idx] = next
          return copy
        })
      } else if (ev === "DELETE") {
        const oldRow = payload.old
        const id = oldRow ? String(oldRow.id ?? "") : ""
        if (!id) return
        setLeadsForThisCampaign((prev) => prev.filter((l) => l.id !== id))
      }
      scheduleDebouncedFullCampaignFetch()
    },
    [campaignId, scheduleDebouncedFullCampaignFetch]
  )

  /** Stop status polling only after sending is fully done — scrape `completed` still needs live updates. */
  const pollStops = useMemo(() => {
    const st = (liveCampaign.status ?? campaign.status ?? "").toLowerCase()
    if (st !== "completed") return false
    const lt = leadsForThisCampaign.length
    const s = queueStats.sent
    const ns = Math.max(0, lt - s)
    return s > 0 && ns === 0
  }, [liveCampaign.status, campaign.status, leadsForThisCampaign.length, queueStats.sent])

  /** Backup poll while scrape/enrich runs — keeps stats aligned if Realtime or batch HTTP races. */
  useEffect(() => {
    if (!campaignId || pollStops) return
    const st = (liveCampaign.status ?? campaign.status ?? "").toLowerCase()
    const busy =
      scrapeUi === "running" ||
      st === "scraping" ||
      st === "running" ||
      st === "enriching"
    if (!busy) return
    const id = window.setInterval(() => {
      void fetchCampaignDataRef.current()
    }, SCRAPE_PROGRESS_POLL_MS)
    return () => clearInterval(id)
  }, [
    campaignId,
    pollStops,
    scrapeUi,
    liveCampaign.status,
    campaign.status,
  ])

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
        (payload) => {
          applyLeadRealtimePayload(
            {
              eventType: payload.eventType,
              new: payload.new as Record<string, unknown> | null,
              old: payload.old as Record<string, unknown> | null,
            },
            "campaign",
            null
          )
        }
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
          (payload) => {
            applyLeadRealtimePayload(
              {
                eventType: payload.eventType,
                new: payload.new as Record<string, unknown> | null,
                old: payload.old as Record<string, unknown> | null,
              },
              "audience",
              String(audId)
            )
          }
        )
        .subscribe()
    }

    return () => {
      void supabase.removeChannel(ch)
      if (ch2) void supabase.removeChannel(ch2)
    }
  }, [campaignId, campaign.audience_id, applyLeadRealtimePayload])

  /** Gmail sync inserts inbound `messages` without updating `leads.status` — refetch so Leads tab matches inbox. */
  useEffect(() => {
    if (!campaignId) return

    const ch = supabase
      .channel(`campaign-inbound-messages-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { lead_id?: string | null; role?: string | null }
          const lid = row.lead_id
          if (!lid || !leadIdsForRealtimeRef.current.has(lid)) return
          const role = (row.role ?? "").toLowerCase()
          if (role !== "inbound" && role !== "lead") return
          void fetchCampaignDataRef.current()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(ch)
    }
  }, [campaignId])

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
          const row = payload.new as { status?: string; leads_found?: number | null }
          setLiveCampaign((prev) => ({
            status: typeof row.status === "string" ? row.status : prev.status,
            leads_found:
              typeof row.leads_found === "number" ? row.leads_found : prev.leads_found,
          }))
          const s = (row.status ?? "").toLowerCase()
          if (s === "completed" || s === "active" || s === "sending") {
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

  const handleStartSending = async () => {
    if (!canStartSending && !canResumeSending) {
      await handleStartScraping()
      return
    }
    if (startSendingUi !== "idle") return
    setStartSendingUi("starting")
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/start-sending`, {
        method: "POST",
      })

      await res.json()

      if (!res.ok) {
        setStartSendingUi("idle")
        return
      }

      setStartSendingUi("awaiting_active")
      void fetchCampaignData()
      router.refresh()
    } catch (err) {
      console.error(err)
      setStartSendingUi("idle")
    }
  }

  const handleStartScraping = useCallback(async () => {
    if (scrapeUi !== "idle") return
    setScrapeUi("running")
    try {
      let done = false
      while (!done) {
        const res = await fetch(
          `/api/scrape-batch?id=${encodeURIComponent(campaign.id)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        )
        const data = (await res.json()) as { done?: boolean }
        void fetchCampaignDataRef.current()
        done = Boolean(data.done)
        if (!res.ok) break
        if (!done) {
          await new Promise((r) => setTimeout(r, 55))
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setScrapeUi("idle")
      void fetchCampaignDataRef.current()
    }
  }, [scrapeUi, campaign.id])

  const handleStartScrapingRef = useRef(handleStartScraping)
  handleStartScrapingRef.current = handleStartScraping

  /** After “Find emails” on create (`?startScrape=1`), run the same scrape loop once — no extra “Start Campaign” click. */
  useEffect(() => {
    if (!autoStartScrape || !campaign.target_search_query?.trim()) return

    const storageKey = `bf-campaign-autoscrape-${campaignId}`
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(storageKey)) {
        return
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(storageKey, "1")
      }
    } catch {
      /* ignore private mode */
    }

    if (autoScrapeMemoryLockRef.current) return
    autoScrapeMemoryLockRef.current = true

    router.replace(`/dashboard/campaigns/${campaignId}`, { scroll: false })
    void handleStartScrapingRef.current()
  }, [autoStartScrape, campaign.target_search_query, campaignId, router])

  const handleStopCampaign = async () => {
    try {
      setIsStopping(true)
      const res = await fetch(`/api/campaigns/${campaign.id}/stop-campaign`, {
        method: "POST",
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to stop")
      setLiveCampaign((prev) => ({ ...prev, status: "paused" }))
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
  const statsTotalLeads = safeLeads.length
  const statsEmailsFound = safeLeads.filter(leadHasNonEmptyEmail).length
  /** Prefer loaded row count from Supabase (updates every lead via Realtime); DB `leads_found` syncs in batches of ~5–15. */
  const leadsFound = Math.max(
    statsTotalLeads,
    typeof liveCampaign.leads_found === "number" ? liveCampaign.leads_found : 0
  )

  const scrapeProgressPercent =
    targetCap > 0 ? Math.min((leadsFound / targetCap) * 100, 100) : 0
  const emailsFound = statsEmailsFound
  const sent = queueStats.sent
  const leadsTotal = statsTotalLeads
  const notSent = Math.max(0, leadsTotal - sent)

  const dbStatus = (liveCampaign.status ?? campaign.status ?? "draft").toLowerCase()
  const isScraping = !!(
    showLeadSection && (dbStatus === "running" || dbStatus === "scraping")
  )
  /** Local scrape loop running before `campaigns.status` flips (e.g. right after “Find emails”). */
  const scrapeUiBusy = scrapeUi === "running"
  const missingEmailCount = Math.max(0, statsTotalLeads - statsEmailsFound)
  const isEnrichingUi =
    dbStatus === "enriching" ||
    (isScraping && statsEmailsFound >= targetCap && missingEmailCount > 0)
  const emailRate =
    statsTotalLeads > 0
      ? Math.round((statsEmailsFound / statsTotalLeads) * 100)
      : 0
  /** All outbound messages delivered (do not conflate with scrape-only `campaigns.status === "completed"`). */
  const sendingComplete = sent > 0 && notSent === 0
  const campaignIsLive = dbStatus === "active" || dbStatus === "sending"
  const canStartSending = leadsTotal > 0 && emailsFound > 0 && sent === 0
  const canResumeSending =
    (dbStatus === "paused" || dbStatus === "stopped") && !campaignIsLive && !sendingComplete
  const activitySpotLabel = campaignIsLive
    ? "Active"
    : sendingComplete
      ? "Completed"
      : dbStatus === "completed" && sent === 0
        ? "Ready"
        : "Idle"

  console.log({
    status: campaign.status,
    leadsTotal,
    emailsFound,
    sent,
  })

  return (
    <div className="space-y-6">
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
            <div className="space-y-2">
              <p className="text-sm text-zinc-200">
                {dbStatus === "scraping" && "Finding leads..."}
                {dbStatus === "enriching" && "Finding emails..."}
                {dbStatus === "completed" && "Complete"}
                {dbStatus === "running" && (showLeadSection ? "Finding leads..." : "Running")}
                {!["scraping", "enriching", "completed", "running"].includes(dbStatus) &&
                  (liveCampaign.status ?? campaign.status ?? "—")}
              </p>
              {(campaignIsLive || isScraping || isEnrichingUi) && !sendingComplete && (
                <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                  Running
                </span>
              )}
            </div>
          </div>
        </div>

        <ScrapingProgressBar
          current={Math.min(leadsFound, targetCap)}
          target={targetCap}
          progressPercent={scrapeProgressPercent}
          statusMessage={
            showLeadSection && dbStatus === "enriching"
              ? "Finding email addresses for remaining leads..."
              : showLeadSection &&
                  (dbStatus === "running" ||
                    dbStatus === "scraping" ||
                    scrapeUiBusy)
                ? leadsFound < targetCap
                  ? leadsFound === 0
                    ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <span>Finding businesses and leads</span>
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                          </div>
                        </div>
                      )
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
                isEnrichingUi
                  ? "text-yellow-400"
                  : isScraping || scrapeUiBusy
                    ? "text-zinc-400"
                    : statsTotalLeads === 0
                      ? "text-zinc-500"
                      : "text-green-400"
              }`}
            >
              {isEnrichingUi ? (
                "Scraping emails…"
              ) : isScraping || scrapeUiBusy ? (
                statsEmailsFound < targetCap ? (
                  "Finding businesses and emails…"
                ) : (
                  "Scraping complete"
                )
              ) : statsTotalLeads === 0 ? (
                ["draft", "paused"].includes(dbStatus) ? (
                  "No leads yet — run lead search above or start below."
                ) : dbStatus === "completed" ? (
                  "Search finished — no leads matched."
                ) : (
                  "No leads loaded yet."
                )
              ) : (
                "Lead data ready"
              )}
            </p>
          </div>
        </div>

      {/* Campaign Activity */}
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">Campaign Activity</h2>
          <span
            className={`text-sm px-3 py-1 rounded-full ${
              sendingComplete
                ? "bg-zinc-600/40 text-zinc-300"
                : campaignIsLive
                  ? "bg-green-500/20 text-green-400"
                  : dbStatus === "completed" && sent === 0
                    ? "bg-sky-500/15 text-sky-300"
                    : "bg-zinc-600/40 text-zinc-400"
            }`}
          >
            {activitySpotLabel}
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
            <div className="text-2xl font-bold text-yellow-400">{notSent}</div>
          </div>

          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Failed</div>
            <div className="text-2xl font-bold text-red-400">{queueStats.failed}</div>
          </div>

          <div className="bg-black/30 rounded-xl p-4">
            <div className="text-xs text-gray-400">Status</div>
            <div
              className={`text-2xl font-bold ${
                sendingComplete ? "text-zinc-300" : queueStats.sent > 0 ? "text-green-400" : "text-zinc-400"
              }`}
            >
              {sendingComplete ? "Completed" : queueStats.sent > 0 ? "Sending" : "Ready"}
            </div>
          </div>
        </div>
      </div>

      {sent > 0 && notSent === 0 && (
        <p className="text-sm text-zinc-300">All emails sent</p>
      )}
      {!sendingComplete && queueStats.sent > 0 && (
        <p className="text-sm text-green-400">Sent {queueStats.sent} emails</p>
      )}
      {startSendingUi === "starting" && (
        <p className="text-sm text-green-400">Starting…</p>
      )}
      {startSendingUi === "awaiting_active" && (
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
        {(canStartSending || canResumeSending) && !campaignIsLive && (
          <button
            type="button"
            onClick={handleStartSending}
            disabled={
              startSendingUi !== "idle" ||
              (!canResumeSending && (isScraping || isEnrichingUi))
            }
            aria-busy={startSendingUi !== "idle"}
            className="bg-green-500 px-4 py-2 rounded font-medium text-sm text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none transition"
          >
            {startSendingUi === "starting"
              ? "Starting…"
              : startSendingUi === "awaiting_active"
                ? "Running…"
                : "Start Sending Messages"}
          </button>
        )}
        {!(canStartSending || canResumeSending) &&
          startSendingUi === "idle" &&
          !campaignIsLive &&
          !sendingComplete && (
          <button
            type="button"
            onClick={handleStartSending}
            disabled={scrapeUi !== "idle" || isScraping || isEnrichingUi}
            className="bg-blue-600 px-4 py-2 rounded font-medium text-sm text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {scrapeUi === "running" || isScraping || isEnrichingUi
              ? "Scraping..."
              : "Start Campaign"}
          </button>
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
              isGenerating={!!(
                showLeadSection &&
                (dbStatus === "running" || dbStatus === "scraping" || dbStatus === "enriching")
              )}
              onLeadAdded={(lead) => {
                setLeadsForThisCampaign((prev) => [...prev, lead])
                void fetchCampaignDataRef.current()
              }}
              onLeadDeleted={(leadId) => {
                setLeadsForThisCampaign((prev) => prev.filter((l) => l.id !== leadId))
                setQueueMessages((prev) => prev.filter((m) => m.lead_id !== leadId))
                void fetchCampaignDataRef.current()
              }}
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
              campaignStatus={dbStatus}
              onSendComplete={() => void fetchCampaignDataRef.current()}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
