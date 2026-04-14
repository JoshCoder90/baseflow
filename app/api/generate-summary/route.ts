import dotenv from "dotenv"
import { rateLimitResponse } from "@/lib/rateLimit"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import { validateUuid } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })

    if (messagesError) {
      console.error("Messages fetch error:", messagesError)
      return NextResponse.json({ error: messagesError.message }, { status: 500 })
    }

    const conversationText = (messages ?? [])
      .filter((m: { role?: string | null; content?: string | null }) => m?.role != null && m?.content != null)
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join("\n")

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an AI CRM assistant. Read the conversation between a sales rep and a lead.

Return ONLY valid JSON using this format:

{
"recommendedAction": string,
"insights": [string, string, string, string]
}

Rules:

recommendedAction should suggest the next step a sales rep should take
insights should be short bullet-style observations (no numeric scores or labels like hot/cold/warm/intent)

Example output:

{
"recommendedAction": "Follow up with more details about your offer",
"insights": [
"Lead asked about services",
"Conversation has a few back-and-forth messages",
"Next step is unclear — suggest a concrete ask",
"Keep tone friendly and brief"
]
}`
        },
        {
          role: "user",
          content: conversationText
        }
      ]
    })

    const content = response.choices[0].message.content || "{}"

    let data: {
      recommendedAction: string
      insights: string[]
    }

    try {
      data = JSON.parse(content)
    } catch {
      data = {
        recommendedAction: "Follow up with the lead",
        insights: ["AI could not analyze this conversation"]
      }
    }

    if (!Array.isArray(data.insights)) {
      data.insights = []
    }
    if (typeof data.recommendedAction !== "string") {
      data.recommendedAction = "Follow up with the lead"
    }

    const summaryForDb = JSON.stringify(data)

    const { error: updateError } = await supabase
      .from("leads")
      .update({ summary: summaryForDb })
      .eq("id", leadId)

    if (updateError) {
      console.error("Leads update error:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Summary error:", error)
    const message = error instanceof Error ? error.message : "Summary generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
