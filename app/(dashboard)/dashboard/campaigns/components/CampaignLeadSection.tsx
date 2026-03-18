"use client"

import { useState } from "react"
import { LeadGenerationProgress } from "./LeadGenerationProgress"
import { CampaignTabs } from "./CampaignTabs"

type Props = {
  campaignId: string
  targetSearchQuery: string
  leadGenerationStatus: "generating" | "complete" | "failed"
  onStatusChange?: (status: "generating" | "complete" | "failed") => void
  onLeadCountChange?: (count: number) => void
  onEditMessages?: () => void
}

export function CampaignLeadSection({
  campaignId,
  targetSearchQuery,
  leadGenerationStatus,
  onStatusChange,
  onLeadCountChange,
  onEditMessages,
}: Props) {
  const [status, setStatus] = useState(leadGenerationStatus)

  function handleStatusChange(s: "generating" | "complete" | "failed") {
    setStatus(s)
    onStatusChange?.(s)
  }

  return (
    <>
      <LeadGenerationProgress
        campaignId={campaignId}
        targetSearchQuery={targetSearchQuery}
        initialStatus={leadGenerationStatus}
        onStatusChange={handleStatusChange}
        onLeadCountChange={onLeadCountChange}
      />
      <CampaignTabs campaignId={campaignId} pollForLeads={status === "generating"} />
    </>
  )
}
