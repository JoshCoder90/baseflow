"use client"

import { useState } from "react"
import Link from "next/link"
import { AddLeadModal } from "@/app/leads/AddLeadModal"
import { supabase } from "@/lib/supabase"

type Lead = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  website?: string | null
  status: string | null
  company: string | null
}

type Props = {
  campaignId: string
  leads: Lead[]
  loading: boolean
  targetLeads?: number
  isGenerating?: boolean
  onLeadAdded?: (lead: Lead) => void
  onLeadDeleted?: (leadId: string) => void | Promise<void>
}

export function CampaignLeadsTable({ campaignId, leads, loading, targetLeads = 200, isGenerating, onLeadAdded, onLeadDeleted }: Props) {
  const handleLeadAdded = (newLead?: Lead) => {
    if (newLead) onLeadAdded?.(newLead)
  }
  const isAtLimit = leads.length >= targetLeads

  const handleDeleteLead = async (leadId: string) => {
    const { error } = await supabase.from("leads").delete().eq("id", leadId)
    if (error) {
      console.error("Delete lead failed:", error)
      return
    }
    onLeadDeleted?.(leadId)
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Leads</h2>
        <AddLeadModal campaignId={campaignId} isAtLimit={isAtLimit} targetLeads={targetLeads} buttonClassName="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-50 disabled:cursor-not-allowed" onSuccess={handleLeadAdded} />
      </div>
      {loading ? (
        <p className="text-sm text-zinc-500">Loading leads…</p>
      ) : leads.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {isGenerating ? "Finding businesses…" : "No leads yet. Add a lead or generate leads to get started."}
        </p>
      ) : (
        <div className="divide-y divide-zinc-700/50 rounded-lg border border-zinc-700/60 overflow-hidden">
          {leads.map((lead) => (
            <ExpandableLeadRow key={lead.id} lead={lead} onDelete={onLeadDeleted ? () => handleDeleteLead(lead.id) : undefined} />
          ))}
        </div>
      )}
    </section>
  )
}

function ExpandableLeadRow({ lead, onDelete }: { lead: Lead; onDelete?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const displayName = lead.name ?? lead.company ?? "—"

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete()
    } catch (err) {
      console.error("Delete failed:", err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-zinc-800/30 hover:bg-zinc-800/50 transition">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 flex items-center gap-2 px-4 py-3 text-left text-sm"
        >
          <span className="text-zinc-400 shrink-0" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
          <span className="font-medium text-white truncate">{displayName}</span>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="shrink-0 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition disabled:opacity-50"
          >
            {deleting ? "…" : "Delete"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-4 pb-4 pl-10 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <span className="text-zinc-500 shrink-0">Email:</span>
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="text-blue-400 hover:underline truncate">
                {lead.email}
              </a>
            ) : (
              <span className="text-zinc-500">—</span>
            )}
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 shrink-0">Phone:</span>
            <span className="text-zinc-300">{lead.phone ?? "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 shrink-0">Website:</span>
            {lead.website ? (
              <a
                href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline truncate"
              >
                {lead.website.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              <span className="text-zinc-500">—</span>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-zinc-500 shrink-0">Status:</span>
            <span className="inline-flex rounded-full border border-zinc-600/60 bg-zinc-700/40 px-2 py-0.5 text-xs font-medium capitalize text-zinc-300">
              {lead.status ?? "Cold"}
            </span>
          </div>
          <Link
            href={`/dashboard/leads/${lead.id}`}
            className="inline-block mt-2 text-xs text-blue-400 hover:text-blue-300"
          >
            View full lead →
          </Link>
        </div>
      )}
    </div>
  )
}
