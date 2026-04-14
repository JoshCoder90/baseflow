type Lead = {
  name?: string | null
  company?: string | null
  email?: string | null
  tag?: string | null
}

export function LeadOverviewCard({ lead }: { lead: Lead }) {
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
        {lead.tag ? (
          <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
            <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-200">
              {lead.tag}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
