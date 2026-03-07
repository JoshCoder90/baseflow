import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { AddLeadModal } from "@/app/leads/AddLeadModal"

function LeadSummaryDisplay({ summary }: { summary?: string | null }) {
  if (!summary || !summary.trim()) {
    return <span className="text-sm text-zinc-500">No summary available</span>
  }
  let parsed: { leadScore?: number; intent?: string; recommendedAction?: string }
  try {
    parsed = JSON.parse(summary) as { leadScore?: number; intent?: string; recommendedAction?: string }
  } catch {
    return <span className="text-sm text-zinc-500">No summary available</span>
  }
  const { leadScore, intent, recommendedAction } = parsed
  return (
    <div className="flex flex-col text-sm gap-0.5">
      <span className="text-neutral-400">
        Score: <span className="text-green-400 font-medium">{leadScore ?? "—"}</span>
      </span>
      <span className="text-neutral-400">
        Intent: <span className="text-yellow-400 font-medium">{intent ?? "—"}</span>
      </span>
      <span className="text-neutral-400 truncate" title={recommendedAction ?? undefined}>
        Action: {recommendedAction ?? "—"}
      </span>
    </div>
  )
}

type Lead = {
  id?: string
  name?: string | null
  email?: string | null
  company?: string | null
  status?: string | null
  tag?: string | null
  summary?: string | null
  [key: string]: unknown
}

async function getLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")

  if (error) {
    console.error("Leads fetch error:", error.message)
    return []
  }
  const list = data ?? []
  list.sort((a, b) => {
    const aVal = (a as { created_at?: string }).created_at ?? ""
    const bVal = (b as { created_at?: string }).created_at ?? ""
    return bVal.localeCompare(aVal)
  })
  return list
}

export default async function LeadsPage() {
  const leads = await getLeads()

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Leads</h1>
            <p className="mt-1 text-zinc-400">Manage and track your outreach leads.</p>
          </div>
          <AddLeadModal />
        </header>

        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          {leads.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-zinc-400">No leads yet. Import or add a lead to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-700/50">
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">Name</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">Email</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">Company</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">Status</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">Tag</th>
                    <th className="text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 px-6 py-4">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id ?? lead.email ?? String(lead)}
                      className="border-b border-zinc-700/30 hover:bg-zinc-700/30 transition"
                    >
                      <td className="px-6 py-4">
                        {lead.id ? (
                          <Link
                            href={`/dashboard/leads/${lead.id}`}
                            className="text-sm font-medium text-white hover:text-blue-400 transition"
                          >
                            {lead.name ?? "—"}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-white">{lead.name ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-zinc-300">{lead.email ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-zinc-400">{lead.company ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-zinc-700/80 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                          {lead.status ?? "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-zinc-400">{lead.tag ?? "—"}</span>
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <LeadSummaryDisplay summary={lead.summary} />
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
