"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { NicheSelector } from "./NicheSelector"
import {
  FollowUpBuilder,
  DEFAULT_FOLLOW_UP_STEPS,
  type FollowUpStep,
} from "./FollowUpBuilder"

type Props = {
  open: boolean
  onClose: () => void
}

export function NewCampaignModal({ open, onClose }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    target_audience: "",
    message_template: "",
    follow_up_steps: DEFAULT_FOLLOW_UP_STEPS as FollowUpStep[],
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const followUpSteps = form.follow_up_steps.filter((s) => s.day >= 3)
    const followUpJson = JSON.stringify(followUpSteps)
    const payload = {
      name: form.name.trim() || null,
      target_audience: form.target_audience.trim() || null,
      message_template: form.message_template.trim() || null,
      follow_up_schedule: followUpJson,
      status: "draft",
    }
    console.log("Saving campaign", payload)

    try {
      const { error: insertError } = await supabase.from("campaigns").insert([payload])
      if (insertError) {
        console.error("Campaign save failed:", insertError)
        setError(insertError.message ?? "Error saving campaign")
        return
      }
      setForm({
        name: "",
        target_audience: "",
        message_template: "",
        follow_up_steps: DEFAULT_FOLLOW_UP_STEPS,
      })
      onClose()
      router.refresh()
    } catch (err) {
      console.error("Campaign save error:", err)
      setError(err instanceof Error ? err.message : "Failed to create campaign")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGenerateScript() {
    if (!form.target_audience.trim()) {
      setError("Select a niche first")
      return
    }
    setError(null)
    setGenerating(true)
    try {
      const res = await fetch("/api/generate-outreach-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: form.target_audience,
          targetAudience: form.target_audience,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to generate")
      if (data.script) {
        setForm((f) => ({ ...f, message_template: data.script }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate script")
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={() => !submitting && onClose()}
        aria-hidden
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div
          className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl overflow-hidden my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 border-b border-zinc-800 shrink-0">
            <h2 className="text-xl font-bold text-white">New Campaign</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Create an outbound campaign.</p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 min-w-0">
            {error && (
              <div className="shrink-0 mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4 space-y-4">
              <div>
              <label
                htmlFor="campaign-name"
                className="block text-sm font-medium text-zinc-400 mb-1.5"
              >
                Campaign name
              </label>
              <input
                id="campaign-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Q1 SaaS outreach"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-white placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Select Niche
              </label>
              <NicheSelector
                value={form.target_audience}
                onChange={(v) => setForm((f) => ({ ...f, target_audience: v }))}
                placeholder="Search niche..."
              />
            </div>
            <div>
              <label
                htmlFor="message-template"
                className="block text-sm font-medium text-zinc-400 mb-1.5"
              >
                Message template
              </label>
              <textarea
                id="message-template"
                rows={4}
                value={form.message_template}
                onChange={(e) => setForm((f) => ({ ...f, message_template: e.target.value }))}
                placeholder="Hi {{name}}, I noticed..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-white placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30 resize-none"
              />
              <button
                type="button"
                onClick={handleGenerateScript}
                disabled={generating}
                className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 transition disabled:opacity-50"
              >
                <svg
                  className="h-4 w-4 text-blue-200"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path d="M12 0L14.59 5.41L20 8l-5.41 2.59L12 16l-2.59-5.41L4 8l5.41-2.59L12 0z" />
                </svg>
                {generating ? "Generating…" : "Generate Outreach Script"}
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Follow-up schedule
              </label>
              <FollowUpBuilder
                value={form.follow_up_steps}
                onChange={(steps) => setForm((f) => ({ ...f, follow_up_steps: steps }))}
                niche={form.target_audience}
                initialMessage={form.message_template}
              />
            </div>
            </div>
            <div className="px-6 py-4 border-t border-zinc-800 flex gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save Campaign"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
