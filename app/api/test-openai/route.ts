import OpenAI from "openai"
import { NextResponse } from "next/server"

export async function GET() {

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
