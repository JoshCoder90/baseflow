"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"

type Stage = "searching" | "enriching" | "filling" | "expanding" | "complete"

type Props = {
  campaignId: string
  targetSearchQuery: string
  initialStatus?: "generating" | "complete" | "failed"
  onStatusChange?: (status: "generating" | "complete" | "failed") => void
  onStageChange?: (stage: Stage | null) => void
  onLeadCountChange?: (count: number) => void
}

/**
 * Subscribes to campaign row updates only. Scraping is started from "Find Leads" (CreateCampaignForm),
 * not from useEffect, so we never auto-fire the API on mount.
 */
export function LeadGenerationProgress({
  campaignId,
  targetSearchQuery: _targetSearchQuery,
  initialStatus = "generating",
  onStatusChange,
  onStageChange,
}: Props) {
  const [status, setStatus] = useState<"generating" | "complete" | "failed">(
    initialStatus
  )
  const [stage, setStage] = useState<Stage | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel(`campaign-status-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${campaignId}` },
        (payload) => {
          const row = payload.new as { lead_generation_status?: string; lead_generation_stage?: string }
          const s = (row?.lead_generation_status ?? status) as "generating" | "complete" | "failed"
          const st = (row?.lead_generation_stage ?? null) as Stage | null
          setStatus(s)
          setStage(st)
          onStatusChange?.(s)
          onStageChange?.(st)
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  return null
}
