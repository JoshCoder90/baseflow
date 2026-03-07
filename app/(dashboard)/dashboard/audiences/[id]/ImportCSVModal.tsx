"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let cell = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (inQuotes) {
      cell += ch
    } else if (ch === "," || ch === "\t") {
      current.push(cell.trim())
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      current.push(cell.trim())
      cell = ""
      if (current.some((c) => c !== "")) rows.push(current)
      current = []
    } else {
      cell += ch
    }
  }
  if (cell !== "" || current.length > 0) {
    current.push(cell.trim())
    if (current.some((c) => c !== "")) rows.push(current)
  }
  return rows
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/\s+/g, "_").trim()
}

export function ImportCSVModal({ audienceId }: { audienceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function closeModal() {
    if (!submitting) {
      setOpen(false)
      setError(null)
      setMessage(null)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length < 2) {
        setError("CSV must have a header row and at least one data row.")
        setSubmitting(false)
        return
      }
      const headers = rows[0].map(normalizeHeader)
      const nameIdx = headers.findIndex((h) => h === "name" || h === "full_name")
      const companyIdx = headers.findIndex((h) => h === "company" || h === "organization")
      const emailIdx = headers.findIndex((h) => h === "email")
      const phoneIdx = headers.findIndex((h) => h === "phone" || h === "phone_number")
      const statusIdx = headers.findIndex((h) => h === "status")

      const toInsert = rows.slice(1).map((row) => {
        const get = (idx: number) => (idx >= 0 && row[idx] !== undefined ? String(row[idx]).trim() : null)
        return {
          audience_id: audienceId,
          name: get(nameIdx) || get(0) || null,
          company: get(companyIdx) || null,
          email: get(emailIdx) || null,
          phone: get(phoneIdx) || null,
          status: get(statusIdx) || "New",
        }
      })

      const { error: insertError } = await supabase.from("audience_leads").insert(toInsert)
      if (insertError) throw insertError
      setMessage(`Imported ${toInsert.length} lead(s).`)
      router.refresh()
      setTimeout(() => closeModal(), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV")
    } finally {
      setSubmitting(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition"
      >
        Import CSV
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-md rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-xl shadow-black/40 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-700/50">
                <h2 className="text-xl font-bold text-white">Import CSV</h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                  Upload a CSV with columns: Name, Company, Email, Phone (optional), Status (optional).
                </p>
              </div>
              <div className="p-6 space-y-4">
                {error && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                {message && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-400">
                    {message}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  disabled={submitting}
                  className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-4 file:py-2 file:text-white file:font-medium hover:file:bg-zinc-600"
                />
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={submitting}
                    className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition disabled:opacity-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
