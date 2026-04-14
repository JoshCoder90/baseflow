"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

type Props = {
  campaignId: string
  messageTemplate: string | null
  subject?: string | null
  targetAudience: string | null
  audienceNiche?: string | null
  onCancel?: () => void
  onSaved?: () => void
  /** When true, always show edit form (for modal/embedded editor) */
  editMode?: boolean
  /** When false, hide the Cancel button (e.g. when used in a tab) */
  showCancel?: boolean
}

export function CampaignDetailsEditor({
  campaignId,
  messageTemplate,
  subject: initialSubject,
  targetAudience,
  audienceNiche,
  onCancel,
  onSaved,
  editMode = false,
  showCancel = true,
}: Props) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(editMode)
  const [subjectEdit, setSubjectEdit] = useState(initialSubject ?? "Quick question")
  const [messageTemplateEdit, setMessageTemplateEdit] = useState(
    messageTemplate ?? ""
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [aiNiche, setAiNiche] = useState(audienceNiche ?? "")
  const [aiOffer, setAiOffer] = useState("")
  const [aiTone, setAiTone] = useState<"Casual" | "Direct" | "Friendly">("Friendly")
  const [aiGoal, setAiGoal] = useState("")
  const [aiCompany, setAiCompany] = useState("")
  const [aiGenerating, setAiGenerating] = useState(false)

  function handleCancel() {
    setSubjectEdit(initialSubject ?? "Quick question")
    setMessageTemplateEdit(messageTemplate ?? "")
    setError(null)
    onCancel?.()
  }

  async function handleSave() {
    setError(null)
    setSubmitting(true)
    const payload = {
      channel: "email" as const,
      subject: subjectEdit.trim() || "Quick question",
      message_template: messageTemplateEdit.trim() || null,
    }
    try {
      const { error: updateError } = await supabase
        .from("campaigns")
        .update(payload)
        .eq("id", campaignId)

      if (updateError) {
        setError(updateError.message ?? "Error updating campaign")
        return
      }
      onSaved?.() ?? router.refresh()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update campaign"
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGenerateScript() {
    const niche = audienceNiche?.trim() || targetAudience?.trim()
    if (!niche) {
      setError("Campaign needs a target audience to generate")
      return
    }
    setError(null)
    setGenerating(true)
    try {
      const res = await fetch("/api/generate-outreach-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche,
          targetAudience: targetAudience ?? niche,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to generate")
      if (data.script) setMessageTemplateEdit(data.script)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate script"
      )
    } finally {
      setGenerating(false)
    }
  }

  async function handleGenerateEmail() {
    const niche = aiNiche.trim() || audienceNiche?.trim() || targetAudience?.trim()
    if (!niche) {
      setError("Enter a niche to generate")
      return
    }
    setError(null)
    setAiGenerating(true)
    try {
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche,
          offer: aiOffer.trim() || undefined,
          tone: aiTone,
          goal: aiGoal.trim() || undefined,
          company: aiCompany.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to generate")
      if (data.subject) setSubjectEdit(data.subject)
      if (data.body) setMessageTemplateEdit(data.body)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate email"
      )
    } finally {
      setAiGenerating(false)
    }
  }

  if (isEditing || editMode) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* AI Email Generator */}
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-5">
          <h3 className="text-sm font-semibold text-white mb-4">AI Email Generator</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
                Niche
              </label>
              <input
                type="text"
                value={aiNiche}
                onChange={(e) => setAiNiche(e.target.value)}
                placeholder="e.g. Dental offices, SaaS startups"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
                Offer
              </label>
              <input
                type="text"
                value={aiOffer}
                onChange={(e) => setAiOffer(e.target.value)}
                placeholder="e.g. Free audit, 15-min call"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
                Tone
              </label>
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value as "Casual" | "Direct" | "Friendly")}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="Casual">Casual</option>
                <option value="Direct">Direct</option>
                <option value="Friendly">Friendly</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
                Goal
              </label>
              <input
                type="text"
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                placeholder="e.g. Book a demo, schedule a call"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
                Company <span className="text-zinc-600">(optional)</span>
              </label>
              <input
                type="text"
                value={aiCompany}
                onChange={(e) => setAiCompany(e.target.value)}
                placeholder="Specific company name if targeting one"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleGenerateEmail}
            disabled={aiGenerating || !(aiNiche.trim() || audienceNiche?.trim() || targetAudience?.trim())}
            className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {aiGenerating ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 0L14.59 5.41L20 8l-5.41 2.59L12 16l-2.59-5.41L4 8l5.41-2.59L12 0z" />
                </svg>
                Generate Email
              </>
            )}
          </button>
        </div>

        <div>
          <label
            htmlFor="subject-edit"
            className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5"
          >
            Email subject
          </label>
          <input
            id="subject-edit"
            type="text"
            value={subjectEdit}
            onChange={(e) => setSubjectEdit(e.target.value)}
            placeholder="Quick question"
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
        <div>
          <label
            htmlFor="message-template-edit"
            className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5"
          >
            Message template
          </label>
          <textarea
            id="message-template-edit"
            rows={4}
            value={messageTemplateEdit}
            onChange={(e) => setMessageTemplateEdit(e.target.value)}
            placeholder="Hey {{first_name}}, I help gyms automate their lead follow-ups so they never miss a membership signup. Want to see how it works?"
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30 resize-none"
          />
          <button
            type="button"
            onClick={handleGenerateScript}
            disabled={generating || !(audienceNiche?.trim() || targetAudience?.trim())}
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
        <div className="flex gap-3 pt-2">
          {showCancel && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Message template
        </dt>
        <dd className="mt-1 text-sm text-zinc-200 whitespace-pre-wrap">
          {messageTemplate ?? "—"}
        </dd>
      </div>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition"
      >
        Edit Campaign
      </button>
    </div>
  )
}
