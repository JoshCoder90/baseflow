"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import {
  FollowUpBuilder,
  DEFAULT_FOLLOW_UP_STEPS,
  type FollowUpStep,
} from "../components/FollowUpBuilder"

const PLACEHOLDER = "Example: Dental offices in New York that may need an AI assistant"
const INITIAL_MESSAGE_PLACEHOLDER =
  "Hey {{first_name}}, I help gyms automate their lead follow-ups so they never miss a membership signup. Want to see how it works?"

type Props = {
  examplePrompts: string[]
}

export function CreateCampaignForm({ examplePrompts }: Props) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [messageTemplate, setMessageTemplate] = useState("")
  const [followUpSteps, setFollowUpSteps] = useState<FollowUpStep[]>(
    DEFAULT_FOLLOW_UP_STEPS
  )
  const [generating, setGenerating] = useState(false)
  const [generatingScript, setGeneratingScript] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSearch = searchQuery.trim().length > 0
  const hasMessage = messageTemplate.trim().length > 0
  const canFindLeads = hasSearch && hasMessage

  function getDisabledTooltip(): string {
    if (!hasMessage) return "Write your outreach message before generating leads."
    if (!hasSearch) return "Enter a target search query to continue."
    return ""
  }

  async function handleFindLeads(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!canFindLeads) return

    const trimmedName = name.trim()
    const trimmedQuery = searchQuery.trim()
    const trimmedMessage = messageTemplate.trim()

    setGenerating(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError("You must be signed in to create a campaign")
        setGenerating(false)
        return
      }

      const followUpStepsValid = followUpSteps.filter((s) => s.day >= 3)
      const followUpSchedule = JSON.stringify(followUpStepsValid)

      const { data: campaign, error: insertError } = await supabase
        .from("campaigns")
        .insert({
          user_id: user.id,
          name: trimmedName || "Untitled campaign",
          target_search_query: trimmedQuery,
          message_template: trimmedMessage,
          follow_up_schedule: followUpSchedule,
          status: "draft",
          channel: "email",
          lead_generation_status: "generating",
          lead_generation_stage: "searching",
        })
        .select("id")
        .single()

      if (insertError) {
        console.error("Campaign create error:", insertError)
        setError(insertError.message ?? "Failed to create campaign")
        setGenerating(false)
        return
      }

      router.push(`/dashboard/campaigns/${campaign.id}`)
      router.refresh()
    } catch (err) {
      console.error("Create campaign error:", err)
      setError(err instanceof Error ? err.message : "Something went wrong")
      setGenerating(false)
    }
  }

  async function handleGenerateScript() {
    const niche = searchQuery.trim()
    if (!niche) {
      setError("Enter a target search query first to generate a script.")
      return
    }
    setError(null)
    setGeneratingScript(true)
    try {
      const res = await fetch("/api/generate-outreach-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, targetAudience: niche }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to generate")
      if (data.script) setMessageTemplate(data.script)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate script")
    } finally {
      setGeneratingScript(false)
    }
  }

  return (
    <form onSubmit={handleFindLeads} className="space-y-10">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Step 1 — Campaign Setup */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Step 1 — Campaign Setup
        </h2>
        <div>
          <label
            htmlFor="campaign-name"
            className="block text-sm font-medium text-zinc-400 mb-2"
          >
            Campaign name
          </label>
          <input
            id="campaign-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q1 Dental Outreach"
            className="w-full rounded-xl border border-zinc-700/80 bg-zinc-800/60 px-4 py-3 text-white placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-offset-zinc-900"
          />
        </div>
        <div>
          <label
            htmlFor="target-leads"
            className="block text-sm font-medium text-zinc-400 mb-2"
          >
            Target search query
          </label>
          <textarea
            id="target-leads"
            rows={4}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={PLACEHOLDER}
            disabled={generating}
            className="w-full rounded-xl border border-zinc-700/80 bg-zinc-800/60 px-4 py-4 text-white placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-offset-zinc-900 resize-none disabled:opacity-60 disabled:cursor-not-allowed text-base"
          />
          <div className="mt-3">
            <p className="text-xs text-zinc-500 mb-2">Examples:</p>
            <div className="flex flex-wrap gap-2">
              {examplePrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setSearchQuery(prompt)}
                  disabled={generating}
                  className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/80 hover:border-zinc-600/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Step 2 — Message Setup */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Step 2 — Message Setup
        </h2>
        <p className="text-sm text-zinc-400">
          Write your initial outreach message before finding leads. Use{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
            {"{{first_name}}"}
          </code>{" "}
          or{" "}
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
            {"{{company}}"}
          </code>{" "}
          for personalization.
        </p>
        <div>
          <label
            htmlFor="initial-message"
            className="block text-sm font-medium text-zinc-400 mb-2"
          >
            Initial Outreach Message <span className="text-red-400">*</span>
          </label>
          <textarea
            id="initial-message"
            rows={5}
            value={messageTemplate}
            onChange={(e) => setMessageTemplate(e.target.value)}
            placeholder={INITIAL_MESSAGE_PLACEHOLDER}
            disabled={generating}
            required
            className="w-full rounded-xl border border-zinc-700/80 bg-zinc-800/60 px-4 py-4 text-white placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-offset-zinc-900 resize-none disabled:opacity-60 disabled:cursor-not-allowed text-base"
          />
          <button
            type="button"
            onClick={handleGenerateScript}
            disabled={generating || generatingScript || !searchQuery.trim()}
            className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className={`h-4 w-4 text-blue-200 ${generatingScript ? "animate-spin" : ""}`}
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path d="M12 0L14.59 5.41L20 8l-5.41 2.59L12 16l-2.59-5.41L4 8l5.41-2.59L12 0z" />
            </svg>
            {generatingScript ? "Generating…" : "Generate Outreach Script"}
          </button>
        </div>
      </section>

      {/* Step 3 — Follow Up Schedule */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Step 3 — Follow Up Schedule
        </h2>
        <p className="text-sm text-zinc-400">
          A default sequence is pre-configured. Edit days and messages as needed.
        </p>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-6">
          <FollowUpBuilder
            value={followUpSteps}
            onChange={setFollowUpSteps}
            niche={searchQuery.trim() || undefined}
            initialMessage={messageTemplate}
          />
        </div>
      </section>

      {/* Step 4 — Generate Leads */}
      <section className="pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Step 4 — Find Leads
        </h2>
        <button
          type="submit"
          disabled={generating || !canFindLeads}
          className="w-full rounded-xl bg-white px-6 py-4 text-base font-semibold text-zinc-900 hover:bg-zinc-100 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-zinc-700"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Creating campaign…
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Find 200 Leads
            </>
          )}
        </button>
        {!canFindLeads && (
          <p className="mt-2 text-center text-sm text-zinc-500">
            {getDisabledTooltip() || "Enter a target search and initial message to continue."}
          </p>
        )}
      </section>
    </form>
  )
}
