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
        className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/70 transition-colors"
      >
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
          Account Health
        </p>
        <p className="text-sm font-semibold">{statusLabel}</p>
        <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{description}</p>
      </div>

      {showHealthModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowHealthModal(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-[400px] max-w-[calc(100vw-2rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">Account Health</h2>

            <p className="text-sm font-semibold text-white mb-1">{statusLabel}</p>
            <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>

            <button
              onClick={() => setShowHealthModal(false)}
              className="mt-6 w-full bg-zinc-800 hover:bg-zinc-700 rounded-lg py-2 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
