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

const VALID_STAGES = ["Lead", "Contacted", "Interested", "Call Booked", "Closed"] as const

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

    if (!conversationText.trim()) {
      const defaultStage = "Lead"
      const { error: updateError } = await supabase
        .from("leads")
        .update({ deal_stage: defaultStage })
        .eq("id", leadId)
      if (updateError) {
        console.error("Leads update error:", updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
      return NextResponse.json({ stage: defaultStage })
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a CRM sales assistant.

Analyze the following sales conversation and determine the current deal stage.

Stages:

Lead
Contacted
Interested
Call Booked
Closed

Definitions:

Lead
Initial outreach or very early replies.

Contacted
Lead responded but shows little engagement.

Interested
Lead asks questions or shows buying curiosity.

Call Booked
Lead agrees to a meeting or scheduling.

Closed
Lead confirms purchase or deal acceptance.

Return ONLY the stage name.`,
        },
        {
          role: "user",
          content: `Conversation:\n${conversationText}`,
        },
      ],
    })

    const rawStage = (response.choices[0].message.content || "Lead").trim()
    const stage = VALID_STAGES.includes(rawStage as (typeof VALID_STAGES)[number])
      ? rawStage
      : "Lead"

    const { error: updateError } = await supabase
      .from("leads")
      .update({ deal_stage: stage })
      .eq("id", leadId)

    if (updateError) {
      console.error("Leads update error:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ stage })
  } catch (error) {
    console.error("Deal stage error:", error)
    const message = error instanceof Error ? error.message : "Deal stage detection failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
