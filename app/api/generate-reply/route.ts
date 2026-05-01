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
          content: `You are a high-performing B2B sales assistant. The conversation below is in chronological order (oldest first). The LAST "user:" lines are the lead's most recent words — your reply options must directly address that latest intent (availability, questions, objections, etc.) and move toward a booked call or concrete next step.

Write replies that sound like a real human salesperson.

Rules:

* Keep replies short (2–4 sentences)
* Friendly and conversational
* Do NOT sound robotic or corporate
* Avoid phrases like "Thank you for your interest"
* Avoid long explanations
* Do NOT repeat or lightly paraphrase what the salesperson ("assistant:") already said unless the lead asked again
* If the lead gave availability or agreed to talk, propose a specific next step (time window, calendar link wording, or "I'll call you at …") when appropriate

Goal:
Close toward a call or a clear commitment.

Generate EXACTLY 3 distinct reply options (different angles or tone).

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
          content: `Conversation (chronological):\n${conversation}`
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