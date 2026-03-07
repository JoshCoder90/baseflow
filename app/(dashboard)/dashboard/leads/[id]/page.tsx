import Link from "next/link"
import { notFound } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { SummaryBlock } from "@/app/leads/[id]/SummaryBlock"
import { LeadOverviewCard } from "@/app/leads/[id]/LeadOverviewCard"
import { ConversationReplySection } from "@/app/leads/[id]/ConversationReplySection"
import { QuickActions } from "@/app/leads/[id]/QuickActions"
import { DealPipeline } from "@/app/leads/[id]/DealPipeline"
import { InternalNotes } from "@/app/leads/[id]/InternalNotes"

type Lead = {
  id: string
  name?: string | null
  email?: string | null
  company?: string | null
  status?: string | null
  tag?: string | null
  summary?: string | null
  deal_stage?: string | null
  internal_notes?: string | null
  [key: string]: unknown
}

async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).single()
  if (error || !data) return null
  return data as Lead
}

export default async function LeadProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const lead = await getLead(id)
  if (!lead) notFound()

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/dashboard/leads"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to leads
        </Link>

        <div className="mb-8">
          <LeadOverviewCard lead={lead} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <SummaryBlock leadId={id} initialSummary={lead.summary} />
            <ConversationReplySection leadId={id} />
          </div>

          <div className="lg:col-span-1 space-y-6">
            <QuickActions />
            <DealPipeline leadId={id} initialStage={lead.deal_stage} />
            <InternalNotes leadId={id} initialNotes={lead.internal_notes} />
          </div>
        </div>
      </div>
    </div>
  )
}
