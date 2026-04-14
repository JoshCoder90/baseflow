import type { SupabaseClient } from "@supabase/supabase-js"

const PAGE_DEBUG = "lead_detail"

export type LeadForDashboardPage = {
  id: string
  name?: string | null
  email?: string | null
  company?: string | null
  status?: string | null
  tag?: string | null
  summary?: string | null
  deal_stage?: string | null
  internal_notes?: string | null
  campaign_id?: string | null
  audience_id?: string | null
  [key: string]: unknown
}

function emptyLeadShell(leadId: string): LeadForDashboardPage {
  return {
    id: leadId,
    name: null,
    email: null,
    company: null,
    status: null,
    tag: null,
    summary: null,
    deal_stage: null,
    internal_notes: null,
    campaign_id: null,
    audience_id: null,
  }
}

async function leadOwnershipForUser(
  supabase: SupabaseClient,
  lead: LeadForDashboardPage,
  authenticatedUserId: string,
  leadId: string
): Promise<"owner" | "denied" | "uncertain"> {
  const campaignId = lead.campaign_id as string | null | undefined
  const audienceId = lead.audience_id as string | null | undefined

  if (campaignId) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("user_id", authenticatedUserId)
      .maybeSingle()

    if (error) {
      console.error(`[${PAGE_DEBUG}] secondary campaigns ownership query error`, {
        requestedId: leadId,
        authenticatedUserId,
        campaignId,
        error,
      })
      return "uncertain"
    }
    if (data) return "owner"
  }

  if (audienceId) {
    const { data, error } = await supabase
      .from("audiences")
      .select("id")
      .eq("id", audienceId)
      .eq("user_id", authenticatedUserId)
      .maybeSingle()

    if (error) {
      console.error(`[${PAGE_DEBUG}] secondary audiences ownership query error`, {
        requestedId: leadId,
        authenticatedUserId,
        audienceId,
        error,
      })
      return "uncertain"
    }
    if (data) return "owner"
  }

  if (campaignId || audienceId) return "denied"

  console.warn(`[${PAGE_DEBUG}] lead has no campaign_id or audience_id`, {
    requestedId: leadId,
  })
  return "uncertain"
}

/**
 * STEP A: `leads` row by id (authenticated client).
 * STEP B: ownership via campaign or audience (errors → uncertain → still show lead).
 * `null` only when the lead row is missing, or ownership is definitively denied.
 */
export async function loadLeadForDashboardPage(
  supabase: SupabaseClient,
  leadId: string,
  authenticatedUserId: string
): Promise<LeadForDashboardPage | null> {
  console.log(`[${PAGE_DEBUG}] load`, {
    page: PAGE_DEBUG,
    requestedId: leadId,
    authenticatedUserId,
  })

  const {
    data: leadRow,
    error: leadErr,
  } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle()

  console.log(`[${PAGE_DEBUG}] main row`, {
    page: PAGE_DEBUG,
    requestedId: leadId,
    authenticatedUserId,
    mainRowFound: Boolean(leadRow),
    mainQueryError: leadErr?.message ?? null,
  })

  if (leadErr) {
    console.error(`[${PAGE_DEBUG}] leads query error`, {
      requestedId: leadId,
      authenticatedUserId,
      error: leadErr,
    })
  }

  if (!leadRow) {
    if (!leadErr) {
      return null
    }
    console.log(`[${PAGE_DEBUG}] using shell after primary query error`, {
      requestedId: leadId,
      authenticatedUserId,
    })
    return emptyLeadShell(leadId)
  }

  const lead = leadRow as LeadForDashboardPage
  const access = await leadOwnershipForUser(supabase, lead, authenticatedUserId, leadId)

  console.log(`[${PAGE_DEBUG}] ownership`, {
    page: PAGE_DEBUG,
    requestedId: leadId,
    authenticatedUserId,
    access,
  })

  if (access === "denied") {
    return null
  }

  return lead
}
