import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { validateQueryUuid } from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

export const dynamic = "force-dynamic"

/**
 * Database-only messages for a lead (no Gmail sync). Used by lead conversation polling.
 */
export async function GET(req: NextRequest) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  const vLead = validateQueryUuid(req.nextUrl.searchParams.get("lead_id"), "lead_id")
  if (!vLead.ok) return vLead.response
  const leadId = vLead.value

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, user_id, campaign_id")
    .eq("id", leadId)
    .maybeSingle()

  if (leadErr || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  const ownsByLead = lead.user_id === user.id
  let ownsByCampaign = false
  if (!ownsByLead && lead.campaign_id) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", lead.campaign_id)
      .eq("user_id", user.id)
      .maybeSingle()
    ownsByCampaign = !!campaign
  }

  if (!ownsByLead && !ownsByCampaign) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  const { data: messages, error } = await supabase
    .from("messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { messages: messages ?? [] },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  )
}
