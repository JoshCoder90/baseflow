import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"
import {
  consumeRateLimit,
  RATE_LIMIT,
  tooManyRequestsJson,
} from "@/lib/rate-limit-policy"
import { validateChatMessages } from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const _ip = heavyRouteIpLimitResponse(req, "generate-reply")
  if (_ip) return _ip

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (
    !consumeRateLimit(
      `bf:ai_reply:${user.id}`,
      RATE_LIMIT.aiReplyPerUserPerMinute,
      60_000
    )
  ) {
    return tooManyRequestsJson("AI reply limit reached (15 per minute). Try again shortly.")
  }

  try {
    const { messages: messagesRaw } = await req.json()
    const vm = validateChatMessages(messagesRaw)
    if (!vm.ok) return vm.response
    const messages = vm.value

    const conversation = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a high-performing B2B sales assistant helping respond to inbound leads.

Write replies that sound like a real human salesperson.

Rules:

* Keep replies short (2–4 sentences)
* Friendly and conversational
* Do NOT sound robotic or corporate
* Avoid phrases like "Thank you for your interest"
* Avoid long explanations
* Focus on moving the conversation forward

Goal:
Get the lead to continue the conversation or book a call.

Generate EXACTLY 3 reply options.

Format exactly like this:

OPTION 1:
(text)

OPTION 2:
(text)

OPTION 3:
(text)`
        },
        {
          role: "user",
          content: `Conversation:\n${conversation}`
        }
      ]
    })

    const reply = response.choices[0].message.content

    return NextResponse.json({ reply })

  } catch (error) {
    console.error("AI reply error:", error)
    return NextResponse.json({ error: "AI failed" }, { status: 500 })
  }
}