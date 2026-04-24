"use client"

import { useEffect } from "react"
import { supabase } from "@/lib/supabase"

type Props = {
  campaignId: string
  /** Kept for call-site compatibility; UI is driven only by `campaigns.status`. */
  targetSearchQuery?: string
  onCampaignStatusChange?: (status: string | null) => void
}

/**
 * Subscribes to `campaigns.status` only (no `lead_generation_*` in the client).
 */
export function LeadGenerationProgress({
  campaignId,
  onCampaignStatusChange,
}: Props) {
  useEffect(() => {
    const channel = supabase
      .channel(`campaign-status-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${campaignId}` },
        (payload) => {
          const row = payload.new as { status?: string | null }
          if (typeof row.status === "string") {
            onCampaignStatusChange?.(row.status)
          }
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [campaignId, onCampaignStatusChange])

  return null
}
