import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { InboxClient } from "./InboxClient"

type Lead = {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  tag?: string | null
  summary?: string | null
  created_at?: string | null
  unread?: boolean | null
  read?: boolean | null
  campaign_id?: string | null
  [key: string]: unknown
}

async function getLeadsWithMessages(userId: string): Promise<Lead[]> {
  const supabase = await createClient()

  const { data: msgData, error: msgError } = await supabase
    .from("messages")
    .select("*")

  if (msgError) {
    console.error("Messages fetch error:", msgError.message)
    return []
  }

  const leadIds = [
    ...new Set(
      (msgData ?? [])
        .map((m) => (m as { lead_id: string }).lead_id)
        .filter(Boolean)
    ),
  ]
  if (leadIds.length === 0) return []

  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .in("id", leadIds)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Leads fetch error:", error.message)
    return []
  }
  return (leads ?? []) as Lead[]
}

type LeadInboxMeta = { lastMessage: string; thread_id: string | null }

/** Preview text + `thread_id` from latest DB `messages` rows per lead (no Gmail API). */
async function getLeadInboxMeta(userId: string): Promise<Record<string, LeadInboxMeta>> {
  const supabase = await createClient()

  const { data: userLeadRows } = await supabase
    .from("leads")
    .select("id")
    .eq("user_id", userId)

  const allowed = new Set((userLeadRows ?? []).map((r) => r.id as string))

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return {}

  const map: Record<string, LeadInboxMeta> = {}
  for (const row of data ?? []) {
    const leadId = (row as { lead_id: string }).lead_id
    const content = (row as { content?: string | null }).content
    const threadId = (row as { thread_id?: string | null }).thread_id ?? null
    if (!leadId || !allowed.has(leadId)) continue

    if (!map[leadId]) {
      map[leadId] = { lastMessage: "(New message)", thread_id: null }
    }
    if (content != null && map[leadId].lastMessage === "(New message)") {
      map[leadId].lastMessage = String(content)
    }
    if (threadId && !map[leadId].thread_id) {
      map[leadId].thread_id = threadId
    }
  }
  return map
}

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const [leads, inboxMetaByLead] = await Promise.all([
    getLeadsWithMessages(user.id),
    getLeadInboxMeta(user.id),
  ])

  const leadsWithMeta = leads.map((lead) => {
    const meta = inboxMetaByLead[lead.id]
    return {
      ...lead,
      last_message: meta?.lastMessage ?? "(New message)",
      thread_id: meta?.thread_id ?? null,
    }
  })

  return <InboxClient leads={leadsWithMeta} />
}
