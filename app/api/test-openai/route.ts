import OpenAI from "openai"
import { NextResponse } from "next/server"
import { rateLimitResponse } from "@/lib/rateLimit"

export async function GET(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl


  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  })

  try {

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: "Say hello"
    })

    return NextResponse.json({
      success: true,
      output: response.output_text
    })

  } catch (err: any) {

    console.error("OpenAI Test Error:", err)

    return NextResponse.json({
      success: false,
      error: err.message
    })
  }
}
