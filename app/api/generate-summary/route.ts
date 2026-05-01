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

function parseModelJson(raw: string): { recommendedAction: string; insights: string[] } | null {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "")
  }
  try {
    const parsed = JSON.parse(s) as { recommendedAction?: unknown; insights?: unknown }
    const recommendedAction =
      typeof parsed.recommendedAction === "string" ? parsed.recommendedAction.trim() : ""
    const insights = Array.isArray(parsed.insights)
      ? parsed.insights
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : []
    if (!recommendedAction && insights.length === 0) return null
    return { recommendedAction: recommendedAction || "—", insights }
  } catch {
    return null
  }
}

const EMPTY_INSIGHTS = {
  recommendedAction:
    "Once there are messages here, refresh this panel or send a note so the summary reflects the real thread.",
  insights: [
    "No messages are visible for this lead yet (or they could not be loaded).",
    "Send a first email from a campaign or Inbox so this thread has history.",
    "After messages exist, open this page again to regenerate insights.",
    "Insights only use text that appears in the stored conversation.",
  ],
} as const

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "generate-summary")
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
      console.error("[generate-summary] messages fetch:", messagesError)
      return NextResponse.json({ error: messagesError.message }, { status: 500 })
    }

    const conversationText = buildLeadConversationTranscript(messages ?? [])

    if (!conversationText.trim()) {
      const data = {
        recommendedAction: EMPTY_INSIGHTS.recommendedAction,
        insights: [...EMPTY_INSIGHTS.insights],
      }
      const summaryForDb = JSON.stringify(data)
      const { error: updateError } = await supabase
        .from("leads")
        .update({ summary: summaryForDb })
        .eq("id", leadId)
      if (updateError) {
        console.error("[generate-summary] leads update:", updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
      return NextResponse.json(data)
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You analyze a single email thread between a sales rep ("Rep") and a prospect ("Lead"). The transcript is chronological: oldest first, newest last.

Return ONLY valid JSON with this exact shape (no markdown, no commentary):
{"recommendedAction": string, "insights": [string, string, string, string]}

Strict rules:
- Every insight MUST be directly supported by something explicit in the transcript. If the transcript does not mention a topic (e.g. pricing, contracts, competitors), you MUST NOT mention that topic.
- Do not invent lead needs, budgets, timelines, or product interest that are not stated or clearly implied by the lead's own words.
- Prefer quoting or paraphrasing the lead's latest message(s) when describing intent.
- "recommendedAction" must be ONE concrete next step for the rep, aligned with the **last few messages** (especially the Lead's most recent line). Example: if the lead says they are available now, recommend calling / sending a calendar link / proposing a specific time now — not a generic "schedule a call later" if they already offered availability.
- "insights" must be exactly four short strings (each one sentence or less), each grounded in the transcript (who said what, tone, stage of dialogue, objection, agreement, etc.).
- Ignore obvious one-word rep typos or spam-like noise unless the lead reacted to them; focus on substantive dialogue.`,
        },
        {
          role: "user",
          content: `Transcript:\n${conversationText}`,
        },
      ],
    })

    const raw = response.choices[0].message.content || "{}"
    let data = parseModelJson(raw)

    if (!data) {
      data = {
        recommendedAction: "Re-read the thread and send a short reply that matches the lead's latest message.",
        insights: [
          "The model could not format a structured summary.",
          "Use the transcript above the insight box as the source of truth.",
          "Try regenerating after a refresh if this persists.",
          "If something looks wrong, verify messages synced from Gmail.",
        ],
      }
    }

    while (data.insights.length < 4) {
      data.insights.push("—")
    }
    data.insights = data.insights.slice(0, 4)

    const summaryForDb = JSON.stringify(data)

    const { error: updateError } = await supabase
      .from("leads")
      .update({ summary: summaryForDb })
      .eq("id", leadId)

    if (updateError) {
      console.error("[generate-summary] leads update:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[generate-summary]", error)
    const message = error instanceof Error ? error.message : "Summary generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
