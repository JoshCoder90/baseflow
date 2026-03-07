import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {

  try {
    const { messages } = await req.json()

    const conversation = messages
      .map((m: any) => `${m.role}: ${m.content}`)
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