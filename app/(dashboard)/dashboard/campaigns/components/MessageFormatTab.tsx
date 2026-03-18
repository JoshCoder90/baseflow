"use client"

import { CampaignDetailsEditor } from "./CampaignDetailsEditor"

type Campaign = {
  id: string
  channel?: string | null
  message_template?: string | null
  follow_up_schedule?: string | null
  subject?: string | null
  target_search_query?: string | null
  target_audience?: string | null
  audiences?: { name: string | null; niche: string | null } | null
}

type Props = {
  campaign: Campaign
  targetLabel: string
  onSaved?: () => void
}

export function MessageFormatTab({ campaign, targetLabel, onSaved }: Props) {
  const audienceNiche =
    campaign.audiences?.niche ?? campaign.audiences?.name ?? campaign.target_search_query ?? campaign.target_audience ?? undefined

  return (
    <CampaignDetailsEditor
      campaignId={campaign.id}
      channel={campaign.channel}
      messageTemplate={campaign.message_template ?? null}
      followUpSchedule={campaign.follow_up_schedule ?? null}
      subject={campaign.subject ?? null}
      targetAudience={targetLabel}
      audienceNiche={audienceNiche}
      onSaved={onSaved}
      editMode
      showCancel={false}
    />
  )
}
