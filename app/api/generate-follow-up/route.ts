import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const STEP_TYPE_LABELS: Record<string, string> = {
  initial: "Initial Message",
  nudge: "Nudge",
  followup: "Follow-up",
  final: "Final Check-in",
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 })
    }
    const { niche, initialMessage, stepType, day } = await req.json()
    if (!niche || !niche.trim()) {
      return NextResponse.json({ error: "niche required" }, { status: 400 })
    }

    const stepLabel = STEP_TYPE_LABELS[stepType] ?? stepType ?? "Follow-up"
    const isNudge = (stepType ?? "").toString().toLowerCase() === "nudge"

    const systemPrompt = isNudge
      ? `You are writing a very short follow-up bump message.

This is a nudge after the original outreach.

Rules:
• Maximum 15 words
• One sentence only
• Friendly tone
• Do not repeat the original message
• No selling or explanation
• Just bump the message

Use placeholder {{name}}.

Example style:
'Hi {{name}}, just bumping this in case it got buried.'

Return ONLY the message text, no quotes or preamble.`
      : `You are writing a follow-up message for a cold outreach campaign.

Niche: ${niche}

Original Message:
${initialMessage || "(No original message provided)"}

Follow-up Type: ${stepLabel}
Day: ${day ?? ""}

Rules:

• Do not repeat the original message
• Keep it under 40 words
• Make it feel like a natural bump
• Reference the niche if possible
• Encourage a short call
• Use {{name}} and {{company}}

Return ONLY the message text, no quotes or preamble.`

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate a ${stepLabel} message for day ${day}.`,
        },
      ],
    })

    const script = (response.choices[0].message.content ?? "").trim()
    return NextResponse.json({ script })
  } catch (error) {
    console.error("Follow-up generation error:", error)
    const message = error instanceof Error ? error.message : "Failed to generate follow-up"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
