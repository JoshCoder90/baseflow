"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

type Props = {
  campaignId: string
  initialNotes?: string | null
}

export function CampaignNotes({ campaignId, initialNotes }: Props) {
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes ?? "")
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNotes(initialNotes ?? "")
  }, [initialNotes])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error("Failed to save")
      setEditing(false)
      router.refresh()
    } catch {
      // Could add error state
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-zinc-700/60 bg-zinc-900/30 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Notes</h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-zinc-400 hover:text-white transition"
          >
            Edit Notes
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-sm font-medium text-zinc-400 hover:text-white transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium text-blue-400 hover:text-blue-300 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about this campaign..."
          className="w-full min-h-[100px] rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none resize-none"
          autoFocus
        />
      ) : (
        <p className="text-sm text-zinc-400 whitespace-pre-wrap min-h-[1.5em]">
          {notes?.trim() || "No notes yet."}
        </p>
      )}
    </section>
  )
}
