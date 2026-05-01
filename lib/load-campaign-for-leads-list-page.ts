import type { SupabaseClient } from "@supabase/supabase-js"
import {
  applyInboundReplyToLeadStatus,
  fetchLeadIdsWithInboundMessages,
} from "@/lib/lead-inbound-reply-status"

const PAGE_DEBUG = "campaign_leads_list"

export type CampaignLeadsListHeader = {
  id: string
  name: string | null
  shell: boolean
}

/** Main `campaigns` row only; secondary failures use shell (never false 404 from query error). */
export async function loadCampaignRowForLeadsListPage(
  supabase: SupabaseClient,
  campaignId: string,
  authenticatedUserId: string
): Promise<CampaignLeadsListHeader | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, user_id")
    .eq("id", campaignId)
    .maybeSingle()

  console.log(`[${PAGE_DEBUG}] main row`, {
    page: PAGE_DEBUG,
    requestedId: campaignId,
    authenticatedUserId,
    mainRowFound: Boolean(data),
    mainQueryError: error?.message ?? null,
  })

  if (error) {
    console.error(`[${PAGE_DEBUG}] campaigns query error`, {
      requestedId: campaignId,
      authenticatedUserId,
      error,
    })
  }

  if (!data) {
    if (!error) {
      return null
    }
    console.log(`[${PAGE_DEBUG}] using shell after primary query error`, {
      requestedId: campaignId,
      authenticatedUserId,
    })
    return { id: campaignId, name: null, shell: true }
  }

  if (data.user_id !== authenticatedUserId) {
    return null
  }

  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    shell: false,
  }
}

export async function loadLeadsRowsForCampaignList(
  supabase: SupabaseClient,
  campaignId: string
): Promise<
  {
    id: string
    name: string | null
    email: string | null
    status: string | null
    last_message_sent_at: string | null
    created_at: string | null
  }[]
> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, email, status, last_message_sent_at, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error(`[${PAGE_DEBUG}] secondary leads list query error`, {
      requestedId: campaignId,
      error,
    })
    return []
  }

  const rows = (data ?? []) as {
    id: string
    name: string | null
    email: string | null
    status: string | null
    last_message_sent_at: string | null
    created_at: string | null
  }[]

  const inboundLeadIds = await fetchLeadIdsWithInboundMessages(
    supabase,
    rows.map((r) => r.id)
  )

  return rows.map((row) => applyInboundReplyToLeadStatus(row, inboundLeadIds))
}
