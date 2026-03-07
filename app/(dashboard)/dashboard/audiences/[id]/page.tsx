import Link from "next/link"
import { notFound } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { AddAudienceLeadModal } from "./AddAudienceLeadModal"
import { ImportCSVModal } from "./ImportCSVModal"

type Audience = {
  id: string
  name: string | null
  niche: string | null
  created_at: string | null
}

type AudienceLead = {
  id: string
  audience_id: string
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
  status: string | null
  created_at: string | null
}

async function getAudience(id: string): Promise<Audience | null> {
  const { data, error } = await supabase.from("audiences").select("*").eq("id", id).single()
  if (error || !data) return null
  return data as Audience
}

async function getAudienceLeads(audienceId: string): Promise<AudienceLead[]> {
  const { data, error } = await supabase
    .from("audience_leads")
    .select("*")
    .eq("audience_id", audienceId)
    .order("created_at", { ascending: false })
  if (error) return []
  return (data ?? []) as AudienceLead[]
}

export default async function AudienceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const audience = await getAudience(id)
  if (!audience) notFound()

  const leads = await getAudienceLeads(id)

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <Link
          href="/dashboard/audiences"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to audiences
        </Link>

        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              {audience.name ?? "Unnamed audience"}
            </h1>
            <p className="mt-1 text-zinc-400">
              {audience.niche ? `Niche: ${audience.niche}` : "Lead list for campaigns."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ImportCSVModal audienceId={id} />
            <AddAudienceLeadModal audienceId={id} />
          </div>
        </header>

        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          {leads.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-zinc-400">No leads in this audience yet. Import CSV or add a lead.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-700/50">
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">
                      Name
                    </th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">
                      Company
                    </th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">
                      Email
                    </th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-zinc-700/30 hover:bg-zinc-700/30 transition"
                    >
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-white">{lead.name ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-zinc-400">{lead.company ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-zinc-300">{lead.email ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-zinc-700/80 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                          {lead.status ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
