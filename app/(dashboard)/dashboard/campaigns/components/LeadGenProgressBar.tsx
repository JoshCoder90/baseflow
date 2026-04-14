"use client"

const LEAD_CAP = 200

type Stage = "searching" | "enriching" | "filling" | "expanding" | "complete"

type Props = {
  leadCount: number
  status: "generating" | "complete" | "failed"
  stage?: Stage | null
}

function getStatusText(
  status: "generating" | "complete" | "failed",
  stage: Stage | null | undefined
): string {
  if (status === "failed") {
    return "Lead generation failed. Check your search query."
  }
  if (status === "complete") {
    return "Lead generation complete."
  }
  // generating
  if (stage === "enriching") {
    return "Finding email addresses..."
  }
  if (stage === "filling") {
    return `Finding more businesses to reach ${LEAD_CAP} emails...`
  }
  if (stage === "expanding") {
    return "Expanding search to find more emails..."
  }
  return "Finding businesses..."
}

export function LeadGenProgressBar({ leadCount, status, stage }: Props) {
  const displayCount = Math.min(leadCount, LEAD_CAP)
  const progress = Math.min(100, (leadCount / LEAD_CAP) * 100)
  const isDone = status === "complete" || status === "failed" || leadCount >= LEAD_CAP
  const statusText = getStatusText(status, stage)
  const showHelper = status === "generating"

  return (
    <div className="mb-8">
      <p className="mb-2 text-sm font-medium text-zinc-300 tabular-nums">
        {displayCount} / {LEAD_CAP} emails
        {isDone && <span className="ml-2 text-emerald-400">✓</span>}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-teal-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-zinc-500">{statusText}</p>
      {showHelper && (
        <p className="text-xs text-gray-500 mt-1">This may take a few minutes.</p>
      )}
    </div>
  )
}
