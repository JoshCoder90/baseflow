"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"

const STAGES = ["Lead", "Contacted", "Interested", "Call Booked", "Closed"] as const

type Props = {
  leadId: string
  initialStage?: string | null
}

function getStageClasses(index: number, activeIndex: number): string {
  const isCompleted = index < activeIndex
  const isActive = index === activeIndex

  if (isCompleted) {
    return "bg-green-500 text-white shadow-md"
  }
  if (isActive) {
    return "bg-blue-500 text-white shadow-md"
  }
  return "bg-neutral-700 text-neutral-300"
}

export function DealPipeline({ leadId, initialStage }: Props) {
  const [stage, setStage] = useState<string>(initialStage ?? "Lead")
  const [isDetecting, setIsDetecting] = useState(false)

  const runDetection = async () => {
    setIsDetecting(true)
    try {
      const res = await fetch("/api/detect-deal-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      })
      const json = await res.json()
      if (json.stage) setStage(json.stage)
    } catch (err) {
      console.error("Deal stage detection error:", err)
    } finally {
      setIsDetecting(false)
    }
  }

  useEffect(() => {
    runDetection()
  }, [leadId])

  useEffect(() => {
    const channel = supabase
      .channel(`lead-${leadId}-deal-stage`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `id=eq.${leadId}`,
        },
        (payload) => {
          const newStage = (payload.new as { deal_stage?: string | null })?.deal_stage
          if (typeof newStage === "string") setStage(newStage)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [leadId])

  const activeIndex = STAGES.indexOf(stage as (typeof STAGES)[number])
  const safeIndex = activeIndex >= 0 ? activeIndex : 0

  return (
    <div className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Deal Progress
        </h2>
        {isDetecting && (
          <span className="text-[10px] text-zinc-500">Detecting…</span>
        )}
      </div>

      {/* Node + line row: stage, line, stage, line, stage, line, stage, line, stage */}
      <div className="flex items-center w-full">
        {STAGES.map((s, i) => (
          <div key={s} className="contents">
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${getStageClasses(i, safeIndex)}`}
              >
                {i + 1}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={`flex-1 h-[2px] mx-2 min-w-0 rounded-full transition-colors ${
                  safeIndex > i ? "bg-green-500" : "bg-neutral-700"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Labels row - centered below each node */}
      <div className="flex items-center w-full mt-2">
        {STAGES.map((s, i) => (
          <div key={s} className="contents">
            <div className="flex flex-col items-center shrink-0 min-w-[2.5rem]">
              <span className="text-xs text-neutral-400 truncate max-w-full text-center px-0.5">
                {s}
              </span>
            </div>
            {i < STAGES.length - 1 && <div className="flex-1 mx-2 min-w-0" />}
          </div>
        ))}
      </div>
    </div>
  )
}
