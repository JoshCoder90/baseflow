"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

const STATUS_OPTIONS = ["New", "Contacted", "Replied", "Interested", "Meeting Booked"]
const TAG_OPTIONS = ["Hot", "Warm", "Cold"]

type LeadRow = { id: string; name: string | null; phone: string | null; email: string | null; website?: string | null; status: string | null; company: string | null }

type Props = {
  campaignId?: string
  buttonClassName?: string
  onSuccess?: (newLead?: LeadRow) => void
  /** When true, button is disabled and submit is blocked (lead limit reached) */
  isAtLimit?: boolean
  /** Used for extra server-side safety check before insert */
  targetLeads?: number
}

export function AddLeadModal({ campaignId, buttonClassName, onSuccess, isAtLimit, targetLeads }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    status: "New",
    tag: "Warm",
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isAtLimit) {
      setError("Lead limit reached")
      return
    }
    if (campaignId && targetLeads != null) {
      const { count } = await supabase.from("leads").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId)
      if ((count ?? 0) >= targetLeads) {
        setError("Lead limit reached")
        return
      }
    }
    setError(null)
    setSubmitting(true)
    try {
      const row: Record<string, unknown> = {
        name: form.name.trim() || null,
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        status: form.status,
        tag: form.tag,
      }
      if (campaignId) row.campaign_id = campaignId
      const { data: inserted, error: insertError } = await supabase.from("leads").insert([row]).select("id, name, phone, email, website, status, company").single()
      if (insertError) throw insertError
      if (campaignId && inserted?.email) {
        try {
          await fetch(`/api/campaigns/${campaignId}/queue-lead`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId: inserted.id }),
          })
        } catch {
          // Non-blocking: lead is saved, queue can be retried
        }
      }
      setForm({ name: "", email: "", company: "", status: "New", tag: "Warm" })
      setOpen(false)
      if (inserted) onSuccess?.(inserted as LeadRow)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add lead")
    } finally {
      setSubmitting(false)
    }
  }

  function closeModal() {
    if (!submitting) {
      setOpen(false)
      setError(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isAtLimit}
        className={`${buttonClassName ?? "rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition shadow-lg shadow-black/20"} ${isAtLimit ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Add Lead
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-md rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-xl shadow-black/40 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-700/50">
                <h2 className="text-xl font-bold text-white">Add Lead</h2>
                <p className="text-sm text-zinc-500 mt-0.5">Create a new lead in your pipeline.</p>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {error && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                <div>
                  <label htmlFor="add-lead-name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Name
                  </label>
                  <input
                    id="add-lead-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Jane Smith"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="add-lead-email" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Email
                  </label>
                  <input
                    id="add-lead-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="e.g. jane@company.com"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="add-lead-company" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Company
                  </label>
                  <input
                    id="add-lead-company"
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                    placeholder="e.g. Acme Inc"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="add-lead-status" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Status
                  </label>
                  <select
                    id="add-lead-status"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="add-lead-tag" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Tag
                  </label>
                  <select
                    id="add-lead-tag"
                    value={form.tag}
                    onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  >
                    {TAG_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={submitting}
                    className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition disabled:opacity-50"
                  >
                    {submitting ? "Saving…" : "Save Lead"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  )
}
