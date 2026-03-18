import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

const MAX_EMAILS_PER_RUN = 10
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""
const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * Run the campaign worker - sends outreach emails to leads with status "new" or "cold".
 * When campaignId is provided, only processes that campaign (for immediate send on start).
 * When campaignId is omitted, processes all active campaigns (for interval worker).
 */
export async function runCampaignWorker(campaignId?: string): Promise<number> {
  console.log("Campaign worker running", campaignId ? `(campaign: ${campaignId})` : "")

  if (!supabaseServiceKey || !process.env.RESEND_API_KEY) {
    console.error("Missing SUPABASE_SERVICE_KEY or RESEND_API_KEY")
    return 0
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, audience_id, message_template, subject")
    .eq("status", "active")

  if (campaignId) {
    campaignsQuery = campaignsQuery.eq("id", campaignId)
  }

  const { data: campaigns } = await campaignsQuery

  if (!campaigns || campaigns.length === 0) {
    return 0
  }

  let sentThisRun = 0

  for (const campaign of campaigns) {
    if (sentThisRun >= MAX_EMAILS_PER_RUN) break

    const leadsQuery = supabase
      .from("leads")
      .select("id, email, name, company")
      .in("status", ["new", "cold"])
      .not("email", "is", null)
      .limit(MAX_EMAILS_PER_RUN - sentThisRun)

    const { data: leads } = campaign.audience_id
      ? await leadsQuery.eq("audience_id", campaign.audience_id)
      : await leadsQuery.eq("campaign_id", campaign.id)

    if (!leads || leads.length === 0) continue

    const subject = (campaign.subject || "Quick question").trim()
    const template = campaign.message_template || ""

    for (const lead of leads) {
      if (sentThisRun >= MAX_EMAILS_PER_RUN) break

      const firstName = (lead.name || "").split(/\s+/)[0] || lead.name || ""
      const compiledHtml = template
        .replace(/\{\{first_name\}\}/gi, firstName)
        .replace(/\{\{name\}\}/gi, lead.name || "")
        .replace(/\{\{company\}\}/gi, lead.company || "")

      try {
        console.log("Sending email to", lead.email)

        const { error } = await resend.emails.send({
          from: "BaseFlow <hello@gobaseflow.com>",
          to: lead.email,
          subject,
          html: `<p>${compiledHtml.replace(/\n/g, "<br />")}</p>`,
        })

        if (error) {
          console.error("Resend error:", error)
          continue
        }

        await supabase
          .from("leads")
          .update({
            status: "messaged",
            messages_sent: 1,
            last_message_sent_at: new Date().toISOString(),
          })
          .eq("id", lead.id)

        sentThisRun++
      } catch (err) {
        console.error("Send failed for", lead.email, err)
      }
    }
  }

  return sentThisRun
}
