import Link from "next/link"
import { notFound } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { CampaignStatusBadge } from "../components/CampaignStatusBadge"
import { CampaignDetailsEditor } from "../components/CampaignDetailsEditor"

type Campaign = {
  id: string
  name?: string | null
  target_audience?: string | null
  message_template?: string | null
  follow_up_schedule?: string | null
  status?: string | null
  created_at?: string | null
}

async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !data) return null
  return data as Campaign
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const campaign = await getCampaign(id)
  if (!campaign) notFound()

  const created = campaign.created_at
    ? new Date(campaign.created_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—"

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <Link
          href="/dashboard/campaigns"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to campaigns
        </Link>

        <header className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                {campaign.name ?? "Untitled campaign"}
              </h1>
              <p className="mt-1 text-zinc-500">Created {created}</p>
            </div>
            <CampaignStatusBadge status={campaign.status} />
          </div>
        </header>

        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
              Campaign details
            </h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Target audience
                </dt>
                <dd className="mt-1 text-sm text-zinc-200">
                  {campaign.target_audience ?? "—"}
                </dd>
              </div>
              <CampaignDetailsEditor
                campaignId={campaign.id}
                messageTemplate={campaign.message_template}
                followUpSchedule={campaign.follow_up_schedule}
                targetAudience={campaign.target_audience}
              />
            </dl>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Prospect list
            </h2>
            <p className="text-sm text-zinc-600">Coming soon</p>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Sending stats
            </h2>
            <p className="text-sm text-zinc-600">Coming soon</p>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Replies
            </h2>
            <p className="text-sm text-zinc-600">Coming soon</p>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Analytics
            </h2>
            <p className="text-sm text-zinc-600">Coming soon</p>
          </section>
        </div>
      </div>
    </div>
  )
}
