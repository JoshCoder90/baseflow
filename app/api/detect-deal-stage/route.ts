import dotenv from "dotenv"
import { rateLimitResponse } from "@/lib/rateLimit"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import { validateUuid } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { buildLeadConversationTranscript } from "@/lib/conversation-transcript-for-lead-ai"
import { userCanAccessLeadRow } from "@/lib/lead-access-for-api"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const VALID_STAGES = ["Lead", "Contacted", "Interested", "Call Booked", "Closed"] as const
type DealStage = (typeof VALID_STAGES)[number]

function normalizeDealStage(raw: string): DealStage {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\.*$/g, "")
    .trim()
  const lower = cleaned.toLowerCase()

  for (const v of VALID_STAGES) {
    if (lower === v.toLowerCase()) return v
  }

  const byLength = [...VALID_STAGES].sort((a, b) => b.length - a.length)
  for (const v of byLength) {
    if (lower.includes(v.toLowerCase())) return v
  }

  return "Lead"
}

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "detect-deal-stage")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 })
    }
    const { leadId: leadIdRaw } = await req.json()
    const v = validateUuid(leadIdRaw, "leadId")
    if (!v.ok) return v.response
    const leadId = v.value

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const allowed = await userCanAccessLeadRow(supabase, user.id, leadId)
    if (!allowed) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })

    if (messagesError) {
      console.error("[detect-deal-stage] messages fetch:", messagesError)
      return NextResponse.json({ error: messagesError.message }, { status: 500 })
    }

    const transcript = buildLeadConversationTranscript(messages ?? [])

    if (!transcript.trim()) {
      const stage: DealStage = "Lead"
      const { error: updateError } = await supabase
        .from("leads")
        .update({ deal_stage: stage })
        .eq("id", leadId)
      if (updateError) {
        console.error("[detect-deal-stage] leads update:", updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
      return NextResponse.json({ stage })
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You assign ONE deal stage for a B2B email thread. Labels are Rep (sales) vs Lead (prospect). Transcript is chronological (oldest first).

Return ONLY valid JSON: {"stage":"<name>"} where <name> is EXACTLY one of:
Lead
Contacted
Interested
Call Booked
Closed

Definitions (pick the single best fit from the **latest** substantive signals; do not guess topics not in the text):

- **Lead**: Almost no dialogue yet, or only outbound from Rep with **no** meaningful Lead reply.
- **Contacted**: Rep has reached out and Lead has replied, but buying intent is **weak** (courtesy, vague, single-word ack, no questions about the offer).
- **Interested**: Lead shows **real buying curiosity** — questions about service/scope/price/timeline, shares needs, or clearly positive intent to explore a purchase.
- **Call Booked**: **Scheduling momentum** — Lead agrees to a call/meeting, proposes availability (e.g. "I'm available now", "call Tuesday"), confirms a time, or accepts a calendar/meeting proposal.
- **Closed**: **Terminal outcome** in the thread — either (a) clear **win** (verbal yes to buy, contract, payment, "send the invoice") or (b) clear **loss** / stop ("not interested", "remove me", hard decline). If unsure between Interested and Closed, choose the less terminal stage.

Never output markdown or extra keys.`,
        },
        {
          role: "user",
          content: `Transcript:\n${transcript}`,
        },
      ],
    })

    const rawJson = response.choices[0].message.content || "{}"
    let stageRaw = "Lead"
    try {
      const parsed = JSON.parse(rawJson) as { stage?: unknown }
      if (typeof parsed.stage === "string") stageRaw = parsed.stage
    } catch {
      stageRaw = "Lead"
    }

    const stage = normalizeDealStage(stageRaw)

    const { error: updateError } = await supabase
      .from("leads")
      .update({ deal_stage: stage })
      .eq("id", leadId)

    if (updateError) {
      console.error("[detect-deal-stage] leads update:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ stage })
  } catch (error) {
    console.error("[detect-deal-stage]", error)
    const message = error instanceof Error ? error.message : "Deal stage detection failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
