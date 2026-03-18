import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { refreshGmailAccessToken } from "@/lib/gmail-auth"
import { getAccountHealth } from "@/lib/account-health"

const resend = new Resend(process.env.RESEND_API_KEY)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

async function sendViaGmail(
  accessToken: string,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string
): Promise<void> {
  const message = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    body,
  ].join("\r\n")

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodedMessage }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail API error: ${res.status} ${err}`)
  }
}

export async function POST(req: NextRequest) {
  console.log("=== START CAMPAIGN HIT ===")

  try {
    let campaignId: string | undefined
    try {
      const body = await req.json()
      campaignId = body?.campaignId
    } catch {
      campaignId = undefined
    }

    const url = new URL(req.url)
    if (!campaignId) campaignId = url.searchParams.get("id") ?? undefined

    if (!campaignId) {
      return NextResponse.json({ error: "campaignId required" }, { status: 400 })
    }

    if (!supabaseServiceKey) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_KEY missing" }, { status: 500 })
    }

    const serverClient = await createServerClient()
    const { data: { user } } = await serverClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, user_id, status, message_template, subject, follow_up_schedule, audience_id")
      .eq("id", campaignId)
      .single()

    if (campaignError || !campaign || campaign.user_id !== user.id) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
    }

    if (campaign.status === "sending") {
      console.log("Campaign already sending - skipping duplicate run")
      return NextResponse.json({ error: "Campaign already sending" }, { status: 409 })
    }

    const { data: gmailConn } = await supabase
      .from("gmail_connections")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()

    const useGmail =
      !!gmailConn?.access_token &&
      !!gmailConn?.gmail_email &&
      gmailConn?.connected === true

    let accessToken = gmailConn?.access_token as string | undefined
    if (useGmail && gmailConn?.refresh_token && accessToken) {
      try {
        accessToken = await refreshGmailAccessToken(gmailConn.refresh_token)
        await supabase
          .from("gmail_connections")
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq("user_id", user.id)
      } catch (err) {
        console.error("Gmail token refresh failed:", err)
        console.log("Falling back to stored access_token (may be expired)")
      }
    }

    const fromEmail = useGmail
      ? gmailConn!.gmail_email
      : "BaseFlow <noreply@gobaseflow.com>"

    console.log("gmailConn:", gmailConn ? { user_id: gmailConn.user_id, gmail_email: gmailConn.gmail_email, connected: gmailConn.connected } : null)
    console.log(useGmail ? "Sending via Gmail" : "Sending via Resend")

    let { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", campaignId)

    if ((!leads || leads.length === 0) && campaign.audience_id) {
      console.log("No leads by campaign_id, trying audience_id:", campaign.audience_id)
      const res = await supabase
        .from("leads")
        .select("*")
        .eq("audience_id", campaign.audience_id)
      leads = res.data
      error = res.error
    }

    console.log("LEADS FOUND:", leads?.length ?? 0, leads)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!leads || leads.length === 0) {
      console.log("NO LEADS FOUND — NOTHING TO QUEUE")
      return NextResponse.json({ message: "No leads found" })
    }

    const eligibleLeads = leads.filter(
      (lead: { email?: string; status?: string }) => !!lead.email && lead.status !== "messaged"
    )

    if (eligibleLeads.length === 0) {
      console.log("NO ELIGIBLE LEADS TO SEND TO (all filtered: need email and status !== 'messaged')")
      return NextResponse.json({ message: "No eligible leads" })
    }

    console.log("ELIGIBLE LEADS:", eligibleLeads.length, eligibleLeads.map((l: { id: string }) => l.id))

    const messageTemplate = campaign.message_template?.trim() || "Hey {{first_name}}, I wanted to reach out. Would love to connect!"
    const subject = campaign.subject?.trim() || "Quick question"

    type FollowUpStep = { day: number; type: string; template?: string }
    function parseFollowUpSchedule(raw: string | null | undefined): FollowUpStep[] {
      if (!raw || typeof raw !== "string") return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    const followUps = parseFollowUpSchedule(campaign.follow_up_schedule)

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

    const { dailyLimit: DAILY_LIMIT } = getAccountHealth({
      created_at: user?.created_at,
      gmail_connected_at:
        (gmailConn?.gmail_connected_at as string | null | undefined) ??
        (gmailConn?.created_at as string | null | undefined),
    })

    const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"
    const { data: userCampaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", user.id)
    const campaignIds = (userCampaigns ?? []).map((c) => c.id)
    let dailySentCount = 0
    if (campaignIds.length > 0) {
      const { count } = await supabase
        .from("campaign_messages")
        .select("*", { count: "exact", head: true })
        .in("campaign_id", campaignIds)
        .eq("status", "sent")
        .gte("sent_at", todayStart)
      dailySentCount = count ?? 0
    }
    if (dailySentCount >= DAILY_LIMIT) {
      return NextResponse.json(
        { error: `Daily limit reached (${DAILY_LIMIT} emails/day)` },
        { status: 429 }
      )
    }

    await supabase
      .from("campaigns")
      .update({ status: "active" })
      .eq("id", campaignId)

    const { data: existingMessages } = await supabase
      .from("campaign_messages")
      .select("lead_id, step_number, status, id")
      .eq("campaign_id", campaignId)

    const existingByKey = new Map<string, { status: string; id: string }>()
    for (const m of existingMessages ?? []) {
      existingByKey.set(`${m.lead_id}:${m.step_number}`, { status: m.status ?? "", id: m.id })
    }

    type QueueStep = { delayDays: number; step: number; template: string }
    const steps: QueueStep[] = [
      { delayDays: 0, step: 1, template: messageTemplate },
    ]
    for (let j = 0; j < followUps.length; j++) {
      const fu = followUps[j]
      const delayDays = fu.day >= 1 ? fu.day : [3, 7, 14][j] ?? 7
      steps.push({
        delayDays,
        step: j + 2,
        template: (fu.template?.trim() || messageTemplate) as string,
      })
    }

    const now = new Date()
    let nextSlot = new Date(now.getTime())
    let insertedCount = 0

    for (const lead of eligibleLeads) {
      if (!lead.email) continue

      console.log("Queueing lead:", lead.id)

      const delayMinutes = 0 // Instant for testing (was: Math.floor(Math.random() * 5) + 1)
      nextSlot = new Date(nextSlot.getTime() + delayMinutes * 60000)
      const baseForLead = new Date(nextSlot.getTime())

      for (const { delayDays, step, template } of steps) {
        const key = `${lead.id}:${step}`
        const existing = existingByKey.get(key)
        const alreadySent = existing?.status === "sent"
        if (alreadySent) {
          console.log("SKIPPING — already sent")
          continue
        }

        const messageBody = personalizeMessage(template, lead)
        const sendAt = new Date().toISOString()

        if (existing) {
          const { error: updateError } = await supabase
            .from("campaign_messages")
            .update({ message_body: messageBody, send_at: sendAt, status: "pending" })
            .eq("id", existing.id)
          if (updateError) {
            console.error("UPDATE ERROR:", updateError)
          } else {
            console.log("RE-QUEUED:", existing.id)
            insertedCount++
          }
        } else {
          const { data: insertData, error: insertError } = await supabase
            .from("campaign_messages")
            .insert({
              lead_id: lead.id,
              campaign_id: campaignId,
              step_number: step,
              channel: "email",
              message_body: messageBody,
              send_at: sendAt,
              status: "pending",
            })
            .select()
          if (insertError) {
            console.error("INSERT ERROR:", insertError)
          } else {
            console.log("INSERT SUCCESS:", insertData)
            insertedCount++
          }
        }
      }
    }

    console.log(`QUEUE INSERT COMPLETE — Queued ${insertedCount} leads`)
    return NextResponse.json({
      success: true,
      queued: insertedCount,
      message: "Campaign started. Emails will send gradually throughout the day.",
    })
  } catch (err) {
    console.error("FULL START CAMPAIGN ERROR:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
