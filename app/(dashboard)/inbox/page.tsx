import { supabase } from "@/lib/supabase"
import { InboxClient } from "./InboxClient"

type Lead = {
  id: string
  name?: string | null
  email?: string | null
  company?: string | null
  status?: string | null
  tag?: string | null
  summary?: string | null
  created_at?: string | null
  [key: string]: unknown
}

async function getLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Leads fetch error:", error.message)
    return []
  }
  return (data ?? []) as Lead[]
}

async function getLatestMessagesByLead(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("messages")
    .select("lead_id, content")
    .order("created_at", { ascending: false })

  if (error) return {}

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    const leadId = (row as { lead_id: string }).lead_id
    const content = (row as { content?: string | null }).content
    if (leadId && content != null && !(leadId in map)) {
      map[leadId] = content
    }
  }
  return map
}

function parseLeadScore(summary: string | null | undefined): number | null {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary)
    const score = parsed?.leadScore
    return typeof score === "number" ? score : null
  } catch {
    return null
  }
}

function getTemperature(score: number | null): string {
  if (score == null) return "❄ Cold"
  if (score >= 80) return "🔥 Hot"
  if (score >= 60) return "🟡 Warm"
  return "❄ Cold"
}

export default async function InboxPage() {
  const [leads, latestMessages] = await Promise.all([
    getLeads(),
    getLatestMessagesByLead(),
  ])

  const leadsWithMeta = leads.map((lead) => {
    const score = parseLeadScore(lead.summary as string | null)
    const temperature = getTemperature(score)
    const lastMessage = latestMessages[lead.id] ?? "No messages yet"
    return {
      ...lead,
      last_message: lastMessage,
      temperature,
      score,
    }
  })

  return <InboxClient leads={leadsWithMeta} />
}
