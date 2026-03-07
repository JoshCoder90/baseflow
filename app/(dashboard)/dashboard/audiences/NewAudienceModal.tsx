"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { NicheSelector } from "@/app/(dashboard)/dashboard/campaigns/components/NicheSelector"
import { LocationAutocomplete, type LocationValue } from "./LocationAutocomplete"

export function NewAudienceModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [niche, setNiche] = useState("")
  const [locationValue, setLocationValue] = useState<LocationValue | null>(null)
  const [businessSize, setBusinessSize] = useState("any")
  const [leadSource, setLeadSource] = useState("")
  const [targetLeads, setTargetLeads] = useState(100)
  const [notes, setNotes] = useState("")

  const BUSINESS_SIZE_OPTIONS = [
    { value: "any", label: "Any" },
    { value: "solo", label: "Solo" },
    { value: "1-10", label: "1–10 employees" },
    { value: "10-50", label: "10–50 employees" },
    { value: "50-200", label: "50–200 employees" },
    { value: "200+", label: "200+ employees" },
  ]
  const LEAD_SOURCE_OPTIONS = [
    "Google Maps",
    "LinkedIn",
    "CSV Import",
    "Manual Add",
    "Website Scrape",
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const audienceName = name.trim()
    if (!audienceName) {
      setError("Audience name is required.")
      return
    }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError("You must be signed in to create an audience.")
      setSubmitting(false)
      return
    }
    const location = locationValue?.location?.trim() || null
    const targetNiche = niche.trim() || null
    const { error: insertError } = await supabase
      .from("audiences")
      .insert([
        {
          user_id: user.id,
          name: audienceName,
          niche: targetNiche,
          location,
          business_size: businessSize || null,
          lead_source: leadSource || null,
          target_leads: targetLeads,
          notes: notes.trim() || null,
        },
      ])
    if (insertError) {
      console.error(insertError)
      setError("Failed to create audience")
      setSubmitting(false)
      return
    }
    setName("")
    setNiche("")
    setLocationValue(null)
    setBusinessSize("any")
    setLeadSource("")
    setTargetLeads(100)
    setNotes("")
    setSubmitting(false)
    setOpen(false)
    setError(null)
    router.refresh()
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
        className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 transition shadow-lg shadow-black/20"
      >
        New Audience
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div
              className="w-full max-w-xl min-h-[520px] flex flex-col rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-xl shadow-black/40 overflow-visible"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-8 border-b border-zinc-700/50 shrink-0">
                <h2 className="text-xl font-bold text-white">New Audience</h2>
                <p className="text-sm text-zinc-500 mt-0.5">Create a lead list for campaigns.</p>
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col flex-1">
                <div className="p-8 space-y-6">
                  {error && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                      {error}
                    </div>
                  )}
                  <div>
                    <label htmlFor="audience-name" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Audience Name
                    </label>
                    <input
                      id="audience-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. SaaS Founders"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                  </div>
                  <div className="relative">
                    <label htmlFor="audience-niche" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Target Niche <span className="text-zinc-500">(optional)</span>
                    </label>
                    <NicheSelector
                      value={niche}
                      onChange={setNiche}
                      placeholder="Select a niche (optional)"
                    />
                  </div>
                  <div>
                    <label htmlFor="audience-location" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Location
                    </label>
                    <LocationAutocomplete
                      id="audience-location"
                      value={locationValue}
                      onChange={setLocationValue}
                      placeholder="e.g. Dallas, Texas or Edmond, Oklahoma"
                    />
                  </div>
                  <div>
                    <label htmlFor="audience-business-size" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Business Size <span className="text-zinc-500">(optional)</span>
                    </label>
                    <select
                      id="audience-business-size"
                      value={businessSize}
                      onChange={(e) => setBusinessSize(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    >
                      {BUSINESS_SIZE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="audience-lead-source" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Lead Source
                    </label>
                    <select
                      id="audience-lead-source"
                      value={leadSource}
                      onChange={(e) => setLeadSource(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    >
                      <option value="">Select lead source</option>
                      {LEAD_SOURCE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="audience-target-leads" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Target Leads
                    </label>
                    <input
                      id="audience-target-leads"
                      type="number"
                      min={1}
                      value={targetLeads}
                      onChange={(e) => setTargetLeads(Number(e.target.value) || 100)}
                      placeholder="e.g. 100"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                  </div>
                  <div>
                    <label htmlFor="audience-notes" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Notes <span className="text-zinc-500">(optional)</span>
                    </label>
                    <textarea
                      id="audience-notes"
                      placeholder="Optional notes about this audience..."
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 p-8 pt-6 border-t border-zinc-700/50 shrink-0">
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
                    {submitting ? "Creating…" : "Create Audience"}
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
