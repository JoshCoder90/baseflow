"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"

type Props = {
  leadId: string
  initialNotes?: string | null
}

export function InternalNotes({ leadId, initialNotes }: Props) {
  const [notes, setNotes] = useState(initialNotes ?? "")
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const loadNotes = async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("internal_notes")
        .eq("id", leadId)
        .single()

      if (!error && data?.internal_notes != null) {
        setNotes(data.internal_notes)
      } else if (initialNotes != null) {
        setNotes(initialNotes)
      }
    }
    loadNotes()
  }, [leadId, initialNotes])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch("/api/save-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, notes }),
      })

      const json = await res.json()
      if (!res.ok) {
        console.error("Notes save error:", json.error)
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error("Notes save error:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-6">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Internal Notes
      </h2>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Write notes about this lead..."
        rows={4}
        className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-sm text-zinc-200 placeholder-neutral-500 outline-none transition focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Notes"}
        </button>
        {saved && (
          <span className="text-xs text-emerald-400">Notes saved</span>
        )}
      </div>
    </div>
  )
}
