"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

const STATUS_OPTIONS = ["New", "Contacted", "Replied", "Interested", "Meeting Booked"]

export function AddAudienceLeadModal({ audienceId }: { audienceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    status: "New",
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { error: insertError } = await supabase.from("audience_leads").insert([
        {
          audience_id: audienceId,
          name: form.name.trim() || null,
          company: form.company.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          status: form.status,
        },
      ])
      if (insertError) throw insertError
      setForm({ name: "", company: "", email: "", phone: "", status: "New" })
      setOpen(false)
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
        className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition"
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
                <p className="text-sm text-zinc-500 mt-0.5">Add a lead to this audience.</p>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {error && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                <div>
                  <label htmlFor="al-name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Name
                  </label>
                  <input
                    id="al-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Jane Smith"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="al-company" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Company
                  </label>
                  <input
                    id="al-company"
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                    placeholder="e.g. Acme Inc"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="al-email" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Email
                  </label>
                  <input
                    id="al-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="e.g. jane@company.com"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="al-phone" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Phone <span className="text-zinc-500">(optional)</span>
                  </label>
                  <input
                    id="al-phone"
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="e.g. +1 555 000 0000"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="al-status" className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Status
                  </label>
                  <select
                    id="al-status"
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
                    {submitting ? "Saving…" : "Add Lead"}
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
