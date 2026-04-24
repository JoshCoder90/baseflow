"use client"

import { useCallback, useEffect, useState } from "react"
import { LeadGenerationProgress } from "./LeadGenerationProgress"
import { CampaignTabs } from "./CampaignTabs"

type Props = {
  campaignId: string
  targetSearchQuery: string
  /** `campaigns.status` from the parent (e.g. draft | running | completed). */
  campaignStatus: string | null
  onCampaignStatusChange?: (status: string | null) => void
  onLeadCountChange?: (count: number) => void
  onEditMessages?: () => void
}

export function CampaignLeadSection({
  campaignId,
  targetSearchQuery,
  campaignStatus,
  onCampaignStatusChange,
  onLeadCountChange,
  onEditMessages,
}: Props) {
  const [status, setStatus] = useState(campaignStatus)

  useEffect(() => {
    setStatus(campaignStatus)
  }, [campaignStatus])

  const handleCampaignStatusChange = useCallback(
    (s: string | null) => {
      setStatus(s)
      onCampaignStatusChange?.(s)
    },
    [onCampaignStatusChange]
  )

  return (
    <>
      <LeadGenerationProgress
        campaignId={campaignId}
        targetSearchQuery={targetSearchQuery}
        onCampaignStatusChange={handleCampaignStatusChange}
      />
      <CampaignTabs
        campaignId={campaignId}
        pollForLeads={(status ?? "").toLowerCase() === "running"}
      />
    </>
  )
}
