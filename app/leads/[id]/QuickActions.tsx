export function QuickActions() {
  const actions = [
    { label: "Send Follow-Up", primary: true },
    { label: "Mark Interested" },
    { label: "Mark Not Interested" },
    { label: "Schedule Call" },
  ]

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Quick Actions
      </h2>
      <div className="flex flex-col gap-2">
        {actions.map(({ label, primary }) => (
          <button
            key={label}
            type="button"
            className={`w-full rounded-lg border px-4 py-2.5 text-left text-sm font-medium transition ${
              primary
                ? "border-blue-600/50 bg-blue-600/10 text-blue-300 hover:bg-blue-600/20"
                : "border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
