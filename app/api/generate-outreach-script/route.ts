import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 })
    }
    const { niche, targetAudience } = await req.json()
    if (!niche || !niche.trim()) {
      return NextResponse.json({ error: "niche required" }, { status: 400 })
    }

    const audience = (targetAudience ?? niche).trim()

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a cold outreach expert who writes messages for marketing agencies.

The agency is targeting businesses in this niche:

Niche: ${niche}

Write a short outreach message that feels natural for this industry.

Rules:

• Mention the niche naturally
• Reference the type of business they run
• Under 60 words
• Friendly tone
• Ask for a quick call
• Use placeholders {{first_name}} and {{company}}
• Make it feel relevant to that industry

Avoid generic wording like 'businesses like yours'.

Make the message feel specific to the niche.

Return ONLY the message text, no quotes or preamble.`,
        },
        {
          role: "user",
          content: `Generate a niche-specific outreach message for ${audience}.`,
        },
      ],
    })

    const script = (response.choices[0].message.content ?? "").trim()
    return NextResponse.json({ script })
  } catch (error) {
    console.error("Outreach script error:", error)
    const message = error instanceof Error ? error.message : "Failed to generate script"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
