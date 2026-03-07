import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { NewAudienceModal } from "./NewAudienceModal"

type Audience = {
  id: string
  name: string | null
  niche: string | null
  created_at: string | null
}

type AudienceWithCount = Audience & { leadCount: number }

async function getAudiencesWithCounts(): Promise<AudienceWithCount[]> {
  const { data: audiences, error: audError } = await supabase
    .from("audiences")
    .select("id, name, niche, created_at")
    .order("created_at", { ascending: false })

  if (audError) {
    console.error("Audiences fetch error:", audError.message)
    return []
  }

  const list = (audiences ?? []) as Audience[]
  if (list.length === 0) return []

  const { data: leads, error: leadsError } = await supabase
    .from("audience_leads")
    .select("audience_id")

  if (leadsError) {
    return list.map((a) => ({ ...a, leadCount: 0 }))
  }

  const countByAudience: Record<string, number> = {}
  for (const row of leads ?? []) {
    const aid = (row as { audience_id: string }).audience_id
    countByAudience[aid] = (countByAudience[aid] ?? 0) + 1
  }

  return list.map((a) => ({
    ...a,
    leadCount: countByAudience[a.id] ?? 0,
  }))
}

export default async function AudiencesPage() {
  const audiences = await getAudiencesWithCounts()

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Audiences</h1>
            <p className="mt-1 text-zinc-400">Lead lists for campaigns.</p>
          </div>
          <NewAudienceModal />
        </header>

        {audiences.length === 0 ? (
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 p-12 text-center">
            <p className="text-zinc-400">No audiences yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {audiences.map((audience) => (
              <Link
                key={audience.id}
                href={`/dashboard/audiences/${audience.id}`}
                className="group block rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-zinc-700 hover:bg-zinc-900"
              >
                <h3 className="font-semibold text-white truncate group-hover:text-blue-400 transition">
                  {audience.name ?? "Unnamed audience"}
                </h3>
                {audience.niche && (
                  <p className="mt-1 text-sm text-zinc-400 truncate">{audience.niche}</p>
                )}
                <p className="mt-2 text-sm text-zinc-400">
                  {audience.leadCount} {audience.leadCount === 1 ? "Lead" : "Leads"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Created{" "}
                  {audience.created_at
                    ? new Date(audience.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
