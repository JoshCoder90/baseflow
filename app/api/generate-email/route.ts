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
  const _ip = heavyRouteIpLimitResponse(req, "generate-email")
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
    const vo = validateText(bodyRaw.offer, {
      required: false,
      maxLen: INPUT_MAX.short,
      field: "offer",
    })
    if (!vo.ok) return vo.response
    const vt = validateText(bodyRaw.tone, {
      required: false,
      maxLen: INPUT_MAX.short,
      field: "tone",
    })
    if (!vt.ok) return vt.response
    const vg = validateText(bodyRaw.goal, {
      required: false,
      maxLen: INPUT_MAX.short,
      field: "goal",
    })
    if (!vg.ok) return vg.response
    const vc = validateText(bodyRaw.company, {
      required: false,
      maxLen: INPUT_MAX.short,
      field: "company",
    })
    if (!vc.ok) return vc.response

    const niche = vn.value
    const offer = vo.value
    const tone = vt.value || "friendly"
    const goal = vg.value
    const company = vc.value

    const systemPrompt = `Write a short cold email for a business owner.

Rules:
- Keep it under 90 words
- Sound natural, casual, and human
- Do not sound corporate or spammy
- Do not use hypey marketing words
- Do not use em dashes
- Start with a short opener
- Mention the company or niche naturally
- End with a low-pressure question
- Make it feel like a real person wrote it

Inputs:
Niche: ${niche}
Offer: ${offer}
Tone: ${tone}
Goal: ${goal}
Company: ${company}

Return valid JSON only, no other text:
{
  "subject": "...",
  "body": "..."
}`

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate a cold email for ${company ?? niche}.`,
        },
      ],
      response_format: { type: "json_object" },
    })

    const contentRaw = (response.choices[0].message.content ?? "").trim()
    let result: { subject: string; body: string }
    try {
      result = JSON.parse(contentRaw) as { subject: string; body: string }
    } catch {
      return NextResponse.json({ error: "Invalid JSON response" }, { status: 500 })
    }

    return NextResponse.json({
      subject: result.subject ?? "",
      body: result.body ?? "",
    })
  } catch (error) {
    console.error("Email generation error:", error)
    const message = error instanceof Error ? error.message : "Failed to generate email"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
