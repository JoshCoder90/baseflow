type Lead = {
  name?: string | null
  company?: string | null
  email?: string | null
  status?: string | null
  tag?: string | null
  summary?: string | null
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

function parseLeadIntent(summary: string | null | undefined): string | null {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary)
    const intent = parsed?.intent
    return typeof intent === "string" ? intent : null
  } catch {
    return null
  }
}

export function LeadOverviewCard({ lead }: { lead: Lead }) {
  const leadScore = parseLeadScore(lead.summary)
  const leadIntent = parseLeadIntent(lead.summary)
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 sm:p-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {lead.name ?? "Unnamed Lead"}
          </h1>
          {lead.company && (
            <p className="mt-1 text-base text-zinc-400">{lead.company}</p>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="mt-0.5 inline-block text-sm text-blue-400 hover:text-blue-300 transition"
            >
              {lead.email}
            </a>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
          {[lead.status, lead.tag].filter(Boolean).map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-200"
            >
              {label}
            </span>
          ))}
          {!lead.status && !lead.tag && (
            <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-500">
              No status
            </span>
          )}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-6 border-t border-zinc-800 pt-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Lead Score
          </p>
          <p className="mt-0.5 text-sm font-medium text-zinc-400">
            {leadScore != null ? leadScore : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Lead Intent
          </p>
          <p className="mt-0.5 text-sm font-medium text-zinc-400">
            {leadIntent ?? "—"}
          </p>
        </div>
      </div>
    </div>
  )
}
