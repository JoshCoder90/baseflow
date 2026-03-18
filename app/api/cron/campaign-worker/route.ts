import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { personalizeMessage } from "@/lib/lead-personalization"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""
const resend = new Resend(process.env.RESEND_API_KEY)

const MAX_DAILY_PER_CAMPAIGN = 50

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

const PHASE_ORDER = ["initial", "bump", "nudge", "follow_up", "final"] as const

function getRequiredDayForPhase(phase: string, schedule: FollowUpStep[]): number {
  if (phase === "initial") return 1
  const idx = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number])
  if (idx <= 0) return 1
  const step = schedule[idx - 1]
  return step?.day ?? [3, 7, 14, 21][idx - 1] ?? 21
}

function getMessageForPhase(
  phase: string,
  campaign: {
    message_template?: string | null
    follow_up_schedule?: string | null
  }
): string {
  if (phase === "initial") {
    return campaign.message_template ?? ""
  }
  const schedule = parseFollowUpSchedule(campaign.follow_up_schedule)
  const step = schedule.find((s) => {
    const t = (s.type ?? "").toLowerCase().replace(/-/g, "_")
    return t === phase || (phase === "follow_up" && t === "followup")
  })
  return step?.template ?? campaign.message_template ?? ""
}

function compileMessage(
  template: string,
  lead: { name?: string | null; company?: string | null }
): string {
  return personalizeMessage(template, lead)
}

/** Campaign worker: runs every minute, sends outreach emails to leads */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 })
    }
  }
  return runWorker()
}

export async function POST(req: Request) {
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
    .select("id, audience_id, message_template, follow_up_schedule, subject, started_at, daily_sends_count, daily_sends_date")
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

    const startedAt = campaign.started_at
      ? new Date(campaign.started_at as string).getTime()
      : new Date(campaign.id).getTime()
    const daysSinceStart = (now.getTime() - startedAt) / 86400000

    const schedule = parseFollowUpSchedule(campaign.follow_up_schedule)
    const scheduleDays = [1, ...schedule.map((s) => s.day ?? 3)].sort((a, b) => a - b)

    const audienceId = campaign.audience_id as string | null
    const leadsQuery = supabase
      .from("leads")
      .select("id, name, email, company, phase, last_message_sent_at, messages_sent")
      .not("email", "is", null)
      .order("last_message_sent_at", { ascending: true, nullsFirst: true })

    const { data: leads } = audienceId
      ? await leadsQuery.eq("audience_id", audienceId)
      : await leadsQuery.eq("campaign_id", campaign.id)

    if (!leads || leads.length === 0) continue

    const subject = (campaign.subject ?? "Quick question").trim() || "Quick question"

    for (const lead of leads) {
      if (dailyCount >= MAX_DAILY_PER_CAMPAIGN) break

      const currentPhase = (lead.phase ?? "initial") as string
      const lastSentAt = lead.last_message_sent_at
        ? new Date(lead.last_message_sent_at as string).getTime()
        : 0
      const messagesSent = lead.messages_sent ?? 0

      let nextPhase: string | null = null

      if (messagesSent === 0) {
        nextPhase = "initial"
      } else {
        const phaseIdx = PHASE_ORDER.indexOf(currentPhase as (typeof PHASE_ORDER)[number])
        if (phaseIdx < 0 || phaseIdx >= PHASE_ORDER.length - 1) continue
        nextPhase = PHASE_ORDER[phaseIdx + 1]
      }

      if (!nextPhase) continue

      const requiredDay = getRequiredDayForPhase(nextPhase, schedule)

      const eligible = daysSinceStart >= requiredDay

      if (!eligible) continue

      const messageBody = getMessageForPhase(nextPhase, campaign)
      const compiled = compileMessage(messageBody, lead)

      try {
        const { error } = await resend.emails.send({
          from: "outreach@gobaseflow.com",
          to: lead.email as string,
          subject,
          html: `<p>${compiled.replace(/\n/g, "<br />")}</p>`,
        })

        if (error) throw new Error(String(error))

        const stepNumber = PHASE_ORDER.indexOf(nextPhase as (typeof PHASE_ORDER)[number]) + 1

        await supabase
          .from("leads")
          .update({
            status: "messaged",
            phase: nextPhase,
            last_message_sent_at: now.toISOString(),
            messages_sent: (lead.messages_sent ?? 0) + 1,
          })
          .eq("id", lead.id)

        const { error: insertErr } = await supabase.from("campaign_messages").insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          step_number: stepNumber,
          channel: "email",
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
  }

  return NextResponse.json({ processed: totalSent, campaigns: campaigns.length })
}
