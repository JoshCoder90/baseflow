import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { personalizeMessage } from "@/lib/lead-personalization"
import { isValidEmail as isCampaignMessageInsertEmail } from "@/lib/campaign-message-insert-email"
import { isValidEmail as validateRecipientEmail } from "@/lib/email-send-filter"
import { OUTBOUND_EMAIL_CHANNEL } from "@/lib/outbound-channel"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""
const resend = new Resend(process.env.RESEND_API_KEY)

const MAX_DAILY_PER_CAMPAIGN = 50

function compileMessage(
  template: string,
  lead: { name?: string | null; company?: string | null }
): string {
  return personalizeMessage(template, lead)
}

/** Campaign worker: runs every minute, sends outreach emails to leads */
export async function GET(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
  }
  return runWorker()
}

export async function POST(req: Request) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
  }
  return runWorker()
}

async function runWorker() {
  if (!supabaseServiceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_KEY missing" },
      { status: 500 }
    )
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY missing" },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, audience_id, message_template, subject, started_at, daily_sends_count, daily_sends_date")
    .eq("status", "active")

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json({ processed: 0, campaigns: 0 })
  }

  let totalSent = 0

  for (const campaign of campaigns) {
    let dailyCount = campaign.daily_sends_count ?? 0
    const dailyDate = campaign.daily_sends_date as string | null

    if (dailyDate !== today) {
      dailyCount = 0
      await supabase
        .from("campaigns")
        .update({ daily_sends_count: 0, daily_sends_date: today })
        .eq("id", campaign.id)
    }

    if (dailyCount >= MAX_DAILY_PER_CAMPAIGN) continue

    const audienceId = campaign.audience_id as string | null
    const leadsQuery = supabase
      .from("leads")
      .select("id, name, email, company, status")
      .not("email", "is", null)

    const { data: leads } = audienceId
      ? await leadsQuery.eq("audience_id", audienceId)
      : await leadsQuery.eq("campaign_id", campaign.id)

    if (!leads || leads.length === 0) continue

    const subject = (campaign.subject ?? "Quick question").trim() || "Quick question"

    let filteredInsertCount = 0

    for (const lead of leads) {
      if (dailyCount >= MAX_DAILY_PER_CAMPAIGN) break

      if (lead.status === "sent") continue

      const messageBody = campaign.message_template ?? ""
      const compiled = compileMessage(messageBody, lead)

      try {
        if (!isCampaignMessageInsertEmail(lead.email as string)) {
          filteredInsertCount++
          console.log("Filtered invalid email:", lead.email)
          continue
        }

        const recipientCheck = await validateRecipientEmail(lead.email)
        if (!recipientCheck.ok) {
          if (recipientCheck.reason === "filtered") {
            console.log(`Filtered out bad email: ${lead.email}`)
          } else {
            console.log(`Skipped invalid email: ${lead.email}`)
          }
          await supabase
            .from("leads")
            .update({ status: "invalid_email", next_send_at: null })
            .eq("id", lead.id)
          continue
        }

        const { error } = await resend.emails.send({
          from: "outreach@gobaseflow.com",
          to: lead.email as string,
          subject,
          html: `<p>${compiled.replace(/\n/g, "<br />")}</p>`,
        })

        if (error) throw new Error(String(error))

        await supabase
          .from("leads")
          .update({
            status: "sent",
          })
          .eq("id", lead.id)

        console.log("✅ UPDATED LEAD:", lead.id)

        const { error: insertErr } = await supabase.from("campaign_messages").insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          step_number: 1,
          channel: OUTBOUND_EMAIL_CHANNEL,
          message_body: compiled,
          send_at: now.toISOString(),
          status: "sent",
          sent_at: now.toISOString(),
        })
        if (insertErr) console.error("campaign_messages insert:", insertErr)

        dailyCount++
        totalSent++

        await supabase
          .from("campaigns")
          .update({
            daily_sends_count: dailyCount,
            daily_sends_date: today,
          })
          .eq("id", campaign.id)
      } catch (err) {
        console.error("Campaign worker send failed:", lead.id, err)
      }
    }

    if (filteredInsertCount > 0) {
      console.log("[campaign-worker] Filtered emails:", filteredInsertCount)
    }
  }

  return NextResponse.json({ processed: totalSent, campaigns: campaigns.length })
}
