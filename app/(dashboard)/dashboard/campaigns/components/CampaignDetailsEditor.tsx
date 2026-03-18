"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { FollowUpBuilder, DEFAULT_FOLLOW_UP_STEPS, type FollowUpStep } from "./FollowUpBuilder"

const TYPE_LABELS: Record<string, string> = {
  bump: "Bump",
  nudge: "Nudge",
  followup: "Follow-up",
  final: "Final Check-in",
}

function parseFollowUps(
  raw: string | FollowUpStep[] | null | undefined
): FollowUpStep[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw !== "string") return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

type Props = {
  campaignId: string
  channel?: string | null
  messageTemplate: string | null
  followUpSchedule: string | null
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
  channel: initialChannel,
  messageTemplate,
  followUpSchedule,
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
  const [channelEdit, setChannelEdit] = useState<"sms" | "email" | "auto">(
    (initialChannel as "sms" | "email" | "auto") || "sms"
  )
  const [subjectEdit, setSubjectEdit] = useState(initialSubject ?? "Quick question")
  const [messageTemplateEdit, setMessageTemplateEdit] = useState(
    messageTemplate ?? ""
  )
  const [followUps, setFollowUps] = useState<FollowUpStep[]>(() => {
    const parsed = parseFollowUps(followUpSchedule)
    return parsed.length > 0 ? parsed : DEFAULT_FOLLOW_UP_STEPS
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  function handleCancel() {
    setChannelEdit((initialChannel as "sms" | "email" | "auto") || "sms")
    setSubjectEdit(initialSubject ?? "Quick question")
    setMessageTemplateEdit(messageTemplate ?? "")
    setFollowUps(parseFollowUps(followUpSchedule))
    setError(null)
    onCancel?.()
  }

  async function handleSave() {
    setError(null)
    setSubmitting(true)
    const followUpSteps = followUps.filter((s) => s.day >= 3)
    const followUpJson = JSON.stringify(followUpSteps)
    const payload = {
      channel: channelEdit,
      subject: subjectEdit.trim() || "Quick question",
      message_template: messageTemplateEdit.trim() || null,
      follow_up_schedule: followUpJson,
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

  if (isEditing || editMode) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Outreach channel
          </label>
          <div className="mt-1 flex flex-col gap-2">
            {(["sms", "email", "auto"] as const).map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-3 cursor-pointer rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 hover:bg-zinc-800 transition"
              >
                <input
                  type="radio"
                  name="channel-edit"
                  checked={channelEdit === opt}
                  onChange={() => setChannelEdit(opt)}
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-blue-500/30"
                />
                <span className="text-sm text-zinc-200">
                  {opt === "sms"
                    ? "SMS"
                    : opt === "email"
                      ? "Email"
                      : "Auto (SMS if phone exists, otherwise email)"}
                </span>
              </label>
            ))}
          </div>
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
        <div>
          <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Follow-up schedule
          </label>
          <div className="mt-1">
            <FollowUpBuilder
              value={followUps}
              onChange={setFollowUps}
              niche={audienceNiche ?? targetAudience ?? undefined}
              initialMessage={messageTemplateEdit}
            />
          </div>
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

  const parsedFollowUps = parseFollowUps(followUpSchedule)

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
      <div>
        <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
          Follow-up schedule
        </dt>
        <dd className="mt-1">
          {parsedFollowUps.length === 0 ? (
            <p className="text-sm text-zinc-500">—</p>
          ) : (
            <div className="flex flex-col gap-y-0">
              {parsedFollowUps.map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                    {i < parsedFollowUps.length - 1 && (
                      <div className="w-px flex-1 min-h-[24px] bg-zinc-700 mx-auto mt-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-6 last:pb-0">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                      <div className="text-sm text-zinc-400">
                        Day {step.day} — {TYPE_LABELS[step.type] ?? step.type}
                      </div>
                      <div className="mt-2 text-sm text-white whitespace-pre-line">
                        {step.template ?? "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
