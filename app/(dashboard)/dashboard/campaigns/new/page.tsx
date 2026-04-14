import Link from "next/link"
import { CreateCampaignForm } from "./CreateCampaignForm"

const EXAMPLE_PROMPTS = [
  "Roofers in Dallas",
  "Dental offices in New York",
  "Marketing agencies in Los Angeles",
  "Gyms in Miami",
]

export default function NewCampaignPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto py-12 sm:py-16 px-4">
        <Link
          href="/dashboard/campaigns"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition mb-8"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to campaigns
        </Link>

        <header className="mb-12">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Create campaign
          </h1>
          <p className="mt-2 text-zinc-500">
            Set up your outreach messages first, then find leads and launch.
          </p>
        </header>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 shadow-xl shadow-black/10">
          <CreateCampaignForm examplePrompts={EXAMPLE_PROMPTS} />
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          We find businesses until you have up to 200 valid emails (safety cap: 800 businesses scanned). Rows include name, email, and website when available.
        </p>
      </div>
    </div>
  )
}
