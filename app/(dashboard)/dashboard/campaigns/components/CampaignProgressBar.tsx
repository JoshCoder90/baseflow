"use client"

type Props = {
  messagesConfigured: boolean
  leadsGenerated: boolean
  campaignRunning: boolean
}

export function CampaignProgressBar({
  messagesConfigured,
  leadsGenerated,
  campaignRunning,
}: Props) {
  const steps = [
    { label: "Messages", done: messagesConfigured },
    { label: "Leads", done: leadsGenerated },
    { label: "Campaign", done: campaignRunning },
  ]

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                step.done
                  ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                  : "bg-zinc-800 text-zinc-500 ring-1 ring-zinc-600/60"
              }`}
              aria-hidden
            >
              {step.done ? "✓" : "○"}
            </div>
            <span
              className={`text-sm font-medium ${
                step.done ? "text-zinc-200" : "text-zinc-500"
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className="mx-3 h-px w-8 shrink-0 bg-zinc-700/60"
              aria-hidden
            />
          )}
        </div>
      ))}
    </div>
  )
}
