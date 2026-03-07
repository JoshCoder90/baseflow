import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { AddLeadModal } from "./AddLeadModal"

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
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white flex flex-col lg:flex-row">
      {/* Sidebar - matches dashboard */}
      <aside className="w-full lg:w-64 flex-shrink-0 bg-zinc-900/98 border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-row lg:flex-col">
        <div className="p-4 lg:p-6 border-b-0 lg:border-b border-r lg:border-r-0 border-zinc-800/80 flex items-center lg:block">
          <Link href="/" className="text-xl font-bold tracking-tight text-white hover:opacity-90">
            BaseFlow
          </Link>
          <p className="hidden lg:block text-xs text-zinc-500 mt-0.5 tracking-wide">Automation control</p>
        </div>
        <nav className="flex-1 flex lg:flex-col gap-0 p-2 lg:p-4 space-y-0 lg:space-y-1 overflow-x-auto">
          <Link href="/" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            Dashboard
          </Link>
          <Link href="#" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13a3 3 0 100-6M12 19h.01" /></svg>
            Campaigns
          </Link>
          <Link href="/leads" className="flex items-center gap-3 rounded-xl bg-zinc-800/80 px-4 py-3 text-sm font-medium text-white border border-zinc-700/50 whitespace-nowrap">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            Leads
          </Link>
          <Link href="/inbox" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 2 0 00-2-2H5a2 2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Inbox
          </Link>
        </nav>
        <div className="hidden lg:flex p-4 space-y-2 border-t border-zinc-800 flex-col">
          <div className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Plan</p>
            <p className="text-sm font-semibold text-white mt-0.5">Growth</p>
          </div>
          <div className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Health</p>
            <p className="text-sm font-semibold text-emerald-400 mt-0.5">Good</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
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
                              href={`/leads/${lead.id}`}
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
      </main>
    </div>
  )
}
