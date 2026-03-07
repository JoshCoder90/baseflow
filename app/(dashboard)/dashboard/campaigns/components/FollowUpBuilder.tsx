"use client"

import { useState } from "react"

export type FollowUpStep = {
  day: number
  type: "nudge" | "followup" | "final"
  template?: string
}

export const DEFAULT_FOLLOW_UP_STEPS: FollowUpStep[] = [
  { day: 3, type: "nudge" },
  { day: 7, type: "followup" },
  { day: 14, type: "final" },
]

const TYPE_LABELS: Record<FollowUpStep["type"], string> = {
  nudge: "Nudge",
  followup: "Follow-up",
  final: "Final Check-in",
}

type Props = {
  value: FollowUpStep[]
  onChange: (steps: FollowUpStep[]) => void
  niche?: string
  initialMessage?: string
}

export function FollowUpBuilder({ value, onChange, niche, initialMessage }: Props) {
  const steps = value.filter((s) => s.day >= 3)
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null)

  function updateSteps(next: FollowUpStep[]) {
    onChange(next)
  }

  function updateStep(index: number, updates: Partial<FollowUpStep>) {
    const next = steps.map((s, i) =>
      i === index ? { ...s, ...updates } : s
    )
    updateSteps(next)
  }

  function addStep() {
    const lastDay = steps.length > 0 ? steps[steps.length - 1].day : 3
    const next = [...steps, { day: lastDay + 3, type: "followup" }]
    updateSteps(next)
  }

  function removeStep(index: number) {
    const next = steps.filter((_, i) => i !== index)
    updateSteps(next)
  }

  async function handleGenerateFollowUp(index: number) {
    if (!niche?.trim()) return
    setGeneratingIndex(index)
    try {
      const res = await fetch("/api/generate-follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          initialMessage: initialMessage?.trim() || "",
          stepType: steps[index]?.type ?? "followup",
          day: steps[index]?.day ?? 3,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to generate")
      if (data.script) {
        updateStep(index, { template: data.script })
      }
    } catch {
      // Error surfaced via optional onError - for now silently fail
    } finally {
      setGeneratingIndex(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-y-6">
        {/* Day 1 — Initial Message (visual only, uses campaign message template) */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
            <div className="w-px flex-1 min-h-[24px] bg-neutral-700 mx-auto mt-1" />
          </div>
          <div className="flex-1 min-w-0 pb-6">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-400">Day</span>
                <span className="text-sm text-zinc-500">1</span>
                <span className="text-sm text-zinc-500">—</span>
                <span className="text-sm font-medium text-zinc-300">Initial Message</span>
              </div>
              <p className="mt-3 text-sm text-zinc-500">Uses the campaign message template above.</p>
            </div>
          </div>
        </div>
        {steps.map((step, index) => (
          <div key={index} className="flex gap-4">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              {index < steps.length - 1 && (
                <div className="w-px flex-1 min-h-[24px] bg-neutral-700 mx-auto mt-1" />
              )}
            </div>
            <div className="flex-1 min-w-0 pb-6 last:pb-0">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-700 transition">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm font-medium text-zinc-400">Day</span>
                    <input
                      type="number"
                      min={3}
                      value={step.day}
                      onChange={(e) =>
                        updateStep(index, {
                          day: Math.max(3, parseInt(e.target.value, 10) || 3),
                        })
                      }
                      className="w-16 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-white outline-none transition focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <span className="text-sm text-zinc-500">—</span>
                    <span className="text-sm font-medium text-zinc-300">
                      {TYPE_LABELS[step.type]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    className="shrink-0 text-zinc-500 hover:text-red-400 transition text-sm"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  placeholder="Optional message template..."
                  value={step.template ?? ""}
                  onChange={(e) =>
                    updateStep(index, { template: e.target.value || undefined })
                  }
                  rows={2}
                  className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
                <button
                  type="button"
                  onClick={() => handleGenerateFollowUp(index)}
                  disabled={!niche?.trim() || generatingIndex === index}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg
                    className="h-4 w-4 text-blue-200"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path d="M12 0L14.59 5.41L20 8l-5.41 2.59L12 16l-2.59-5.41L4 8l5.41-2.59L12 0z" />
                  </svg>
                  {generatingIndex === index ? "Generating…" : "Generate Follow-up"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addStep}
        className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-700 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 hover:bg-neutral-800/50 transition"
      >
        + Add Follow-up
      </button>
    </div>
  )
}
