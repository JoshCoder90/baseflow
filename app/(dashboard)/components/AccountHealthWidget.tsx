"use client"

import { useState } from "react"

export type AccountHealthData = {
  status: string
  dailyLimit: number
  daysActive: number
  nextLimit: number | null
  nextUpgradeDay: number | null
  daysUntilUpgrade: number
}

type Props = {
  data: AccountHealthData
}

function statusDescription(status: string): string {
  if (status === "Optimized") {
    return "Sending reputation is strong"
  }
  if (status === "At Risk") {
    return "High activity detected — slow down"
  }
  return "Warming up sending capacity"
}

export function AccountHealthWidget({ data }: Props) {
  const [showHealthModal, setShowHealthModal] = useState(false)
  const { status } = data

  const statusLabel =
    status === "Warming Up"
      ? "🟡 Warming Up"
      : status === "Stable"
        ? "🟢 Stable"
        : status === "Healthy"
          ? "🟢 Healthy"
          : status === "At Risk"
            ? "🔴 At Risk"
            : "🚀 Optimized"

  const description = statusDescription(status)

  return (
    <>
      <div
        onClick={() => setShowHealthModal(true)}
        className="bf-panel cursor-pointer rounded-xl px-4 py-3 transition hover:border-white/[0.12]"
      >
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
          Account Health
        </p>
        <p className="text-sm font-semibold">{statusLabel}</p>
        <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{description}</p>
      </div>

      {showHealthModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowHealthModal(false)}
        >
          <div
            className="bf-panel w-full max-w-[400px] rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">Account Health</h2>

            <p className="mb-1 text-sm font-semibold text-white">{statusLabel}</p>
            <p className="text-sm leading-relaxed text-zinc-400">{description}</p>

            <button
              type="button"
              onClick={() => setShowHealthModal(false)}
              className="mt-6 w-full rounded-lg border border-white/[0.1] bg-white/[0.06] py-2.5 text-sm font-medium transition hover:bg-white/[0.1]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
