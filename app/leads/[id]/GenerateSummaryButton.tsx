"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type Props = { leadId: string; onSuccess?: (summary: string) => void }

export function GenerateSummaryButton({ leadId, onSuccess }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ leadId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "Request failed")
        return
      }
      if (data.summary) {
        onSuccess?.(data.summary)
      }
      router.refresh()
    } catch {
      setError("Request failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 hover:border-zinc-500 transition disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate Summary"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      )}
    </div>
  )
}
