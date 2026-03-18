"use client"

import { useState } from "react"

type Campaign = {
  id: string
  name?: string | null
  status?: string | null
}

type Props = {
  campaign: Campaign | null
  open: boolean
  onClose: () => void
  onConfirm: (campaignId: string) => Promise<void>
}

export function DeleteCampaignModal({ campaign, open, onClose, onConfirm }: Props) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    if (!campaign) return
    setDeleting(true)
    try {
      await onConfirm(campaign.id)
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  const hasSentMessages = campaign?.status === "active"

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={() => !deleting && onClose()}
        aria-hidden
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold text-white">Delete Campaign?</h2>
          <p className="mt-2 text-sm text-zinc-400">
            This will permanently delete{" "}
            <span className="font-medium text-zinc-200">{campaign?.name ?? "Untitled campaign"}</span>{" "}
            and its message history.
          </p>
          {hasSentMessages && (
            <p className="mt-2 text-sm text-amber-400">
              This campaign has sent messages. Deleting it will remove its history.
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={deleting}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 transition disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete Campaign"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
