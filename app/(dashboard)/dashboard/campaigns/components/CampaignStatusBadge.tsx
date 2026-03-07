type Status = "draft" | "active" | "paused"

const STATUS_STYLES: Record<Status, string> = {
  draft: "bg-zinc-700/60 text-zinc-300 border-zinc-600/50",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
}

export function CampaignStatusBadge({ status }: { status?: string | null }) {
  const s = (status ?? "draft").toLowerCase() as Status
  const style = STATUS_STYLES[s] ?? STATUS_STYLES.draft
  const label = s.charAt(0).toUpperCase() + s.slice(1)
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  )
}
