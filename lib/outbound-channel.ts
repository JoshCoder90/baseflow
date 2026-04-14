/**
 * Outbound pipeline is email-only: campaign_messages and messages use this channel.
 * No SMS / Twilio — do not branch on other channel values.
 */
export const OUTBOUND_EMAIL_CHANNEL = "email" as const
