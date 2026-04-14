import dotenv from "dotenv"
import { rateLimitResponse } from "@/lib/rateLimit"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import {
  INPUT_MAX,
  validateOptionalInt,
  validateText,
} from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const STEP_TYPE_LABELS: Record<string, string> = {
  initial: "Initial Message",
  bump: "Bump",
  nudge: "Nudge",
  followup: "Follow-up",
  final: "Final Check-in",
}

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "generate-follow-up")
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
    const vim = validateText(bodyRaw.initialMessage, {
      required: false,
      maxLen: INPUT_MAX.medium,
      field: "initialMessage",
    })
    if (!vim.ok) return vim.response
    const vst = validateText(bodyRaw.stepType, {
      required: false,
      maxLen: 50,
      field: "stepType",
    })
    if (!vst.ok) return vst.response
    const vd = validateOptionalInt(bodyRaw.day, "day", 1, 366)
    if (!vd.ok) return vd.response

    const niche = vn.value
    const initialMessage = vim.value
    const stepType = vst.value
    const day = vd.value

    const stepLabel = STEP_TYPE_LABELS[stepType] ?? stepType ?? "Follow-up"
    const stepTypeLower = stepType.toLowerCase()
    const isShortBump = stepTypeLower === "nudge" || stepTypeLower === "bump"

    const systemPrompt = isShortBump
      ? `You are writing a very short follow-up bump message.

This is a nudge after the original outreach.

Rules:
• Maximum 15 words
• One sentence only
• Friendly tone
• Do not repeat the original message
• No selling or explanation
• Just bump the message

Use placeholder {{first_name}}.

Example style:
'Hi {{first_name}}, just bumping this in case it got buried.'

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
• Use {{first_name}} and {{company}}

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
