import { NextResponse } from "next/server"
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET() {
  console.log("Sending test email via Resend")

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not set" },
      { status: 500 }
    )
  }

  try {
    const { error } = await resend.emails.send({
      from: "BaseFlow <hello@gobaseflow.com>",
      to: "joshbird9090@gmail.com",
      subject: "BaseFlow Test",
      html: "<p>This is a test email from BaseFlow.</p>",
    })

    if (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
