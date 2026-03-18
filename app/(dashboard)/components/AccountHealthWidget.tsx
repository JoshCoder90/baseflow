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

export function AccountHealthWidget({ data }: Props) {
  const [showHealthModal, setShowHealthModal] = useState(false)
  const { status, dailyLimit, daysActive, nextLimit, nextUpgradeDay, daysUntilUpgrade } = data

  const statusLabel =
    status === "Warming Up"
      ? "🟡 Warming Up"
      : status === "Stable"
        ? "🟢 Stable"
        : status === "Healthy"
          ? "🟢 Healthy"
          : "🚀 Optimized"

  const progressPercent =
    nextUpgradeDay != null ? Math.min((daysActive / nextUpgradeDay) * 100, 100) : 100

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
        <p className="text-xs text-zinc-400 mt-1">Limit: {dailyLimit}/day</p>
        {nextLimit != null && daysUntilUpgrade > 0 && (
          <p className="text-xs text-zinc-500 mt-1">
            {nextLimit}/day in {daysUntilUpgrade}d
          </p>
        )}
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

            <p className="text-sm text-zinc-400">
              We gradually increase your sending limit to protect your Gmail
              account from being flagged as spam.
            </p>

            <div className="mt-4 space-y-2">
              <p>
                Status: <span className="font-semibold">{statusLabel}</span>
              </p>
              <p>Daily Limit: {dailyLimit} emails</p>
              <p>Days Active: {daysActive}</p>

              {nextLimit != null && (
                <p className="text-sm text-zinc-400">
                  Next upgrade: {nextLimit} emails/day in {daysUntilUpgrade} day
                  {daysUntilUpgrade !== 1 ? "s" : ""}
                </p>
              )}
              {!nextLimit && (
                <p className="text-green-400 text-sm">You&apos;re fully optimized 🚀</p>
              )}
            </div>

            {nextUpgradeDay != null && (
              <div className="mt-4 h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}

            <div className="mt-4 text-xs text-zinc-500">
              Sending too many emails too quickly can get your account flagged.
              This system keeps your emails landing in inboxes.
            </div>

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
