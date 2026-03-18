/**
 * Campaign send logic: resolves channel (sms/email) per lead based on campaign settings.
 */

export type CampaignChannel = "sms" | "email" | "auto"

export type LeadContact = {
  id: string
  phone?: string | null
  email?: string | null
}

/**
 * Resolve effective channel for a lead given campaign channel.
 * Returns "sms" | "email" if lead can be reached, null if not.
 */
export function resolveChannel(
  campaignChannel: CampaignChannel,
  lead: LeadContact
): "sms" | "email" | null {
  const hasPhone = !!lead.phone?.trim()
  const hasEmail = !!lead.email?.trim()

  switch (campaignChannel) {
    case "sms":
      return hasPhone ? "sms" : null
    case "email":
      return hasEmail ? "email" : null
    case "auto":
      if (hasPhone) return "sms"
      if (hasEmail) return "email"
      return null
    default:
      return hasPhone ? "sms" : hasEmail ? "email" : null
  }
}

/**
 * Filter leads to those reachable via the campaign's channel.
 */
export function filterReachableLeads<T extends LeadContact>(
  campaignChannel: CampaignChannel,
  leads: T[]
): { lead: T; channel: "sms" | "email" }[] {
  const result: { lead: T; channel: "sms" | "email" }[] = []
  for (const lead of leads) {
    const ch = resolveChannel(campaignChannel, lead)
    if (ch) result.push({ lead, channel: ch })
  }
  return result
}
