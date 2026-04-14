"use client"

import { useState, useEffect } from "react"

type InsightData = {
  recommendedAction: string
  insights: string[]
}

const defaultData: InsightData = {
  recommendedAction: "—",
  insights: [],
}

type Props = { leadId: string; initialSummary?: string | null }

export function SummaryBlock({ leadId }: Props) {
  const [data, setData] = useState<InsightData>(defaultData)
  const [loadingSummary, setLoadingSummary] = useState(true)

  useEffect(() => {
    let cancelled = false

    const generateSummary = async () => {
      setLoadingSummary(true)
      try {
        const res = await fetch("/api/generate-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        })

        const json = await res.json()
        if (cancelled) return
        if (Array.isArray(json.insights)) {
          setData({
            recommendedAction:
              typeof json.recommendedAction === "string" ? json.recommendedAction : "—",
            insights: json.insights ?? [],
          })
        }
      } catch (err) {
        console.error("Summary error:", err)
      } finally {
        if (!cancelled) setLoadingSummary(false)
      }
    }

    generateSummary()

    const onMessagesChanged = (e: Event) => {
      const ce = e as CustomEvent<{ leadId?: string }>
      if (ce.detail?.leadId !== leadId) return
      void generateSummary()
    }
    window.addEventListener("bf-lead-messages-changed", onMessagesChanged)
    return () => {
      cancelled = true
      window.removeEventListener("bf-lead-messages-changed", onMessagesChanged)
    }
  }, [leadId])

  const { recommendedAction, insights } = data

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 sm:p-8">
      {loadingSummary ? (
        <p className="text-zinc-400">Analyzing conversation...</p>
      ) : (
        <div className="bg-neutral-900 rounded-xl p-5 border border-neutral-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-400">AI Insight</span>
          </div>

          <div className="space-y-2 mb-4">
            {insights.length === 0 ? (
              <p className="text-sm text-gray-500">No insights yet</p>
            ) : (
              insights.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-200">
                  <span className="text-zinc-500">•</span>
                  <span>{item}</span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-neutral-800 pt-4 text-sm">
            <span className="text-gray-400">Recommended</span>
            <div className="text-white font-semibold mt-1">{recommendedAction}</div>
          </div>
        </div>
      )}
    </div>
  )
}
