"use client"

export function EmptyCampaignState({ onNewCampaign }: { onNewCampaign: () => void }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-zinc-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13a3 3 0 100-6M12 19h.01"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-white">No campaigns yet</h3>
      <p className="mt-2 text-sm text-zinc-500 max-w-sm mx-auto">
        Create your first campaign to start reaching out to leads with targeted messaging.
      </p>
      <button
        type="button"
        onClick={onNewCampaign}
        className="mt-6 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition"
      >
        Create first campaign
      </button>
    </div>
  )
}
