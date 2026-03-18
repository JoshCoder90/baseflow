import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
)
const resend = new Resend(process.env.RESEND_API_KEY)

function personalizeMessage(
  template: string,
  lead: { name?: string | null; company?: string | null }
): string {
  const firstName = (lead.name ?? "").split(/\s+/)[0] || (lead.name ?? "there")
  return template
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{name\}\}/gi, lead.name ?? "")
    .replace(/\{\{company\}\}/gi, lead.company ?? "")
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    console.log("=== FETCHING LEADS ===")
    console.log("Campaign ID:", id)

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("message_template, subject")
      .eq("id", id)
      .single()

    const messageTemplate = campaign?.message_template?.trim() || "Hey {{first_name}}, I wanted to reach out. Would love to connect!"
    const subject = campaign?.subject?.trim() || "Quick question"

    const { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", id)

    if (!leads) {
      return NextResponse.json({ error: "Leads null" }, { status: 500 })
    }

    if (leads.length === 0) {
      return NextResponse.json({ message: "No leads found" })
    }

    let sentCount = 0
    for (const lead of leads) {
      if (!lead.email) continue
      if (lead.status === "messaged") continue

      const personalizedMessage = personalizeMessage(messageTemplate, lead)
      const htmlBody = personalizedMessage.includes("<") ? personalizedMessage : `<p>${personalizedMessage.replace(/\n/g, "<br />")}</p>`

      console.log("Sending to:", lead.email)
      const { error: sendError } = await resend.emails.send({
        from: "BaseFlow <noreply@gobaseflow.com>",
        to: lead.email,
        subject,
        html: htmlBody,
      })

      if (!sendError) {
        sentCount++
        await supabase.from("leads").update({ status: "messaged", messages_sent: 1, last_message_sent_at: new Date().toISOString() }).eq("id", lead.id)
      }
    }

    return NextResponse.json({ success: true, leadsCount: leads.length, sentCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("FULL ERROR:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
