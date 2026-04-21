"use client"

import type { ReactNode } from "react"

type Props = {
  current: number
  target: number
  /** When set, bar width uses this (same source as lead counts). */
  progressPercent?: number
  statusMessage?: ReactNode | null
}

export function ScrapingProgressBar({ current, target, progressPercent, statusMessage }: Props) {
  const progress =
    progressPercent != null
      ? Math.min(100, progressPercent)
      : target
        ? Math.min(100, (current / target) * 100)
        : 0
  return (
    <div className="mb-8">
      <p className="mb-2 text-sm font-medium text-zinc-300 tabular-nums">
        {current} / {target} leads
        {current >= target && <span className="ml-2 text-emerald-400">✓</span>}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-teal-500"
          style={{ width: `${progress}%`, transition: "width 0.3s ease" }}
        />
      </div>
      {statusMessage != null && statusMessage !== "" && (
        <div className="mt-2">
          {typeof statusMessage === "string" ? (
            <p className="text-sm text-zinc-500">{statusMessage}</p>
          ) : (
            statusMessage
          )}
        </div>
      )}
    </div>
  )
}
