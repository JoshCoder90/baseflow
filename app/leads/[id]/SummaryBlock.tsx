"use client"

import { useState, useEffect } from "react"

type InsightData = {
  leadScore: number
  intent: string
  recommendedAction: string
  insights: string[]
}

const defaultData: InsightData = {
  leadScore: 0,
  intent: "—",
  recommendedAction: "—",
  insights: [],
}

type Props = { leadId: string; initialSummary?: string | null }

export function SummaryBlock({ leadId }: Props) {
  const [data, setData] = useState<InsightData>(defaultData)
  const [loadingSummary, setLoadingSummary] = useState(true)

  useEffect(() => {
    const generateSummary = async () => {
      try {
        const res = await fetch("/api/generate-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        })

        const json = await res.json()
        if (json.leadScore != null && Array.isArray(json.insights)) {
          setData({
            leadScore: Number(json.leadScore) ?? 0,
            intent: json.intent ?? "—",
            recommendedAction: json.recommendedAction ?? "—",
            insights: json.insights ?? [],
          })
        }
      } catch (err) {
        console.error("Summary error:", err)
      } finally {
        setLoadingSummary(false)
      }
    }

    generateSummary()
  }, [leadId])

  const { leadScore, intent, recommendedAction, insights } = data

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
                  <span className="text-green-500">●</span>
                  <span>{item}</span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-neutral-800 pt-4 flex gap-8 text-sm">
            <div>
              <span className="text-gray-400">Lead Score</span>
              <div className="text-white font-semibold">{leadScore}</div>
            </div>
            <div>
              <span className="text-gray-400">Intent</span>
              <div className="text-white font-semibold">{intent}</div>
            </div>
            <div>
              <span className="text-gray-400">Recommended</span>
              <div className="text-white font-semibold">{recommendedAction}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
