import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
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
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 })
    }
    const { leadId } = await req.json()
    if (!leadId) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 })
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("role, content, created_at")
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
          content: `You are an AI CRM assistant helping sales teams prioritize leads.

Analyze the conversation between a sales rep and a lead.

Your job is to determine how likely the lead is to convert.

Use this scoring framework:

Start with a base score of 20.

Add points based on these signals:

+20 if the lead asks about services or what the company offers
+30 if the lead asks about pricing, demos, results, or ROI
+20 if the lead sends multiple messages or engages actively
+30 if the lead mentions timing or urgency (soon, next month, immediately)

Score interpretation:

0–30 = Cold lead
31–60 = Medium interest
61–80 = Strong interest
81–100 = Hot lead

Return ONLY valid JSON using this format:

{
"leadScore": number,
"intent": "Low" | "Medium" | "High",
"recommendedAction": string,
"insights": [string, string, string, string]
}

Rules:

leadScore must be between 0 and 100
intent should match the score range
recommendedAction should suggest the next step a sales rep should take
insights should be short bullet-style observations about the lead

Example output:

{
"leadScore": 50,
"intent": "Medium",
"recommendedAction": "Follow up with more details about the lead generation service",
"insights": [
"Lead asked about services",
"Shows initial interest",
"Conversation engagement is minimal",
"Follow-up likely needed"
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
      leadScore: number
      intent: string
      recommendedAction: string
      insights: string[]
    }

    try {
      data = JSON.parse(content)
    } catch {
      data = {
        leadScore: 50,
        intent: "Medium",
        recommendedAction: "Follow up with the lead",
        insights: ["AI could not analyze this conversation"]
      }
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
