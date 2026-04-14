"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

export type CampaignLeadRow = {
  id: string
  name: string | null
  email: string | null
  status: string | null
  last_message_sent_at: string | null
  created_at: string | null
}

type StatusFilter = "all" | "sent" | "replied" | "not_contacted"

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase()
}

function isSent(s: string | null | undefined) {
  return norm(s) === "sent"
}

function isReplied(s: string | null | undefined) {
  const t = norm(s)
  return t === "replied" || t.includes("reply")
}

function matchesFilter(lead: CampaignLeadRow, f: StatusFilter): boolean {
  if (f === "all") return true
  const st = lead.status
  if (f === "sent") return isSent(st)
  if (f === "replied") return isReplied(st)
  return !isSent(st) && !isReplied(st)
}

function formatActivity(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function lastActivityAt(lead: CampaignLeadRow) {
  return lead.last_message_sent_at || lead.created_at || null
}

type Props = {
  leads: CampaignLeadRow[]
  leadDetailBasePath: string
}

export function CampaignLeadsClient({ leads, leadDetailBasePath }: Props) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter((lead) => {
      if (!matchesFilter(lead, statusFilter)) return false
      if (!q) return true
      const name = norm(lead.name)
      const email = norm(lead.email)
      return name.includes(q) || email.includes(q)
    })
  }, [leads, query, statusFilter])

  const filterBtn = (id: StatusFilter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setStatusFilter(id)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        statusFilter === id
          ? "bg-white text-zinc-900"
          : "bg-zinc-800/80 text-zinc-400 hover:text-white border border-zinc-700/60"
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Search leads…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:max-w-sm rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          aria-label="Search leads"
        />
        <div className="flex flex-wrap items-center gap-2">
          {filterBtn("all", "All")}
          {filterBtn("sent", "Sent")}
          {filterBtn("replied", "Replied")}
          {filterBtn("not_contacted", "Not contacted")}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/30 px-6 py-14 text-center text-zinc-400">
          {leads.length === 0
            ? "No leads in this campaign yet."
            : "No leads match your search or filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-zinc-700/50">
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Name
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Email
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Last activity
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-zinc-700/30 transition hover:bg-zinc-700/25"
                >
                  <td className="px-6 py-4">
                    <Link
                      href={`${leadDetailBasePath}/${lead.id}`}
                      className="text-sm font-medium text-white hover:text-sky-400 transition"
                    >
                      {lead.name?.trim() || "—"}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-300">{lead.email?.trim() || "—"}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center rounded-full bg-zinc-700/80 px-2.5 py-0.5 text-xs font-medium capitalize text-zinc-200">
                      {lead.status?.trim() || "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-400 tabular-nums">
                    {formatActivity(lastActivityAt(lead))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
