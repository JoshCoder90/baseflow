import dotenv from "dotenv"
import { rateLimitResponse } from "@/lib/rateLimit"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import { INPUT_MAX, validateText } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "generate-outreach-script")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 })
    }
    const bodyRaw = await req.json()
    const vn = validateText(bodyRaw.niche, {
      required: true,
      maxLen: INPUT_MAX.short,
      field: "niche",
    })
    if (!vn.ok) return vn.response
    const vta = validateText(bodyRaw.targetAudience, {
      required: false,
      maxLen: INPUT_MAX.short,
      field: "targetAudience",
    })
    if (!vta.ok) return vta.response

    const niche = vn.value
    const audience = vta.value || niche

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
• Make it feel relevant to that industry
• DO NOT use any placeholders or variables: never output {{first_name}}, {{company}}, {{name}}, [Company], or similar
• Write the message as if sending to a general reader in this niche (no merge fields)
• Write the message without using any personalization variables or placeholders.
• The final text must be clean static copy: no curly braces {{ }}, no square brackets used as variables, no template tokens

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
