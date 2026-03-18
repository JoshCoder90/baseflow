"use client"

import { useState, useRef, useEffect } from "react"

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function adjustHeight(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    el.style.height = `${Math.max(140, el.scrollHeight)}px`
  }

  useEffect(() => {
    const el = ref.current
    if (el) adjustHeight(el)
  }, [value])

  function handleInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.target as HTMLTextAreaElement
    onChange(el.value)
    adjustHeight(el)
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onInput={handleInput}
      placeholder={placeholder}
      className={className}
      rows={1}
    />
  )
}

export type FollowUpStep = {
  day: number
  type: "bump" | "nudge" | "followup" | "final"
  template?: string
}

export const DEFAULT_FOLLOW_UP_STEPS: FollowUpStep[] = [
  { day: 3, type: "bump" },
  { day: 7, type: "nudge" },
  { day: 14, type: "followup" },
  { day: 21, type: "final" },
]

const TYPE_LABELS: Record<FollowUpStep["type"], string> = {
  bump: "Bump",
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
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-[11px] top-0 bottom-0 w-px bg-gradient-to-b from-blue-500/60 via-zinc-600/80 to-zinc-700/60" />
      <div className="space-y-0">
        {/* Day 1 — Initial Message */}
        <div className="relative pl-10 pb-6">
          <div className="absolute left-0 top-0.5 w-[22px] h-[22px] rounded-full bg-blue-500/20 border-2 border-blue-500 flex items-center justify-center">
            <span className="text-[10px] font-semibold text-blue-400">1</span>
          </div>
          <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-200">Day 1</span>
              <span className="text-sm text-zinc-500">—</span>
              <span className="text-sm font-medium text-zinc-400">Initial Message</span>
            </div>
            <p className="mt-2 text-sm text-zinc-500">Uses the campaign message template above.</p>
          </div>
        </div>
        {steps.map((step, index) => (
          <div key={index} className="relative pl-10 pb-6 last:pb-0">
            <div className="absolute left-0 top-0.5 w-[22px] h-[22px] rounded-full bg-zinc-800 border-2 border-blue-500/80 flex items-center justify-center">
              <span className="text-[10px] font-semibold text-blue-400">{step.day}</span>
            </div>
            <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 p-4 hover:border-zinc-600/80 transition-shadow hover:shadow-lg hover:shadow-black/5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium text-zinc-400">Day</span>
                  <input
                    type="number"
                    min={2}
                    value={step.day}
                    onChange={(e) =>
                      updateStep(index, {
                        day: Math.max(2, parseInt(e.target.value, 10) || 2),
                      })
                    }
                    className="w-14 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-sm text-white outline-none transition focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  />
                  <span className="text-sm text-zinc-500">—</span>
                  <span className="text-sm font-semibold text-zinc-300">
                    {TYPE_LABELS[step.type as FollowUpStep["type"]] ?? step.type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  className="shrink-0 text-zinc-500 hover:text-red-400 transition text-sm font-medium"
                >
                  Remove
                </button>
              </div>
              <AutoResizeTextarea
                value={step.template ?? ""}
                onChange={(v) => updateStep(index, { template: v || undefined })}
                placeholder="Write a message or use AI Assist..."
                className="mt-4 w-full min-h-[120px] resize-y overflow-hidden p-4 leading-relaxed text-base rounded-lg border border-zinc-700 bg-zinc-800/80 text-zinc-200 placeholder-zinc-600 outline-none transition focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
              />
              <button
                type="button"
                onClick={() => handleGenerateFollowUp(index)}
                disabled={!niche?.trim() || generatingIndex === index}
                className="mt-3 flex items-center gap-2 rounded-lg bg-blue-600/90 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className={`h-4 w-4 text-blue-200 ${generatingIndex === index ? "animate-spin" : ""}`}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path d="M12 0L14.59 5.41L20 8l-5.41 2.59L12 16l-2.59-5.41L4 8l5.41-2.59L12 0z" />
                </svg>
                {generatingIndex === index ? "Generating…" : "AI Assist"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
