"use client"

import { useState, useRef, useEffect } from "react"

const NICHES = [
  "SaaS",
  "Ecommerce",
  "Real Estate",
  "Dentists",
  "Chiropractors",
  "Med Spas",
  "Cosmetic Surgeons",
  "Veterinarians",
  "Weight Loss Clinics",
  "Plumbing",
  "HVAC",
  "Roofing",
  "Landscaping",
  "Electricians",
  "Pest Control",
  "Garage Door Services",
  "Restoration Companies",
  "General Contractors",
  "Kitchen Remodeling",
  "Bathroom Remodeling",
  "Auto Repair",
  "Auto Dealerships",
  "Car Detailing",
  "Car Rentals",
  "Personal Injury Lawyers",
  "Criminal Defense Lawyers",
  "Divorce Lawyers",
  "Bankruptcy Lawyers",
  "Commercial Cleaning",
  "IT Services",
  "Managed Service Providers",
  "Cybersecurity Companies",
  "Marketing Agencies",
  "Recruiting Agencies",
  "Coaching Businesses",
  "Consultants",
  "Gyms",
  "Yoga Studios",
  "Health Coaches",
  "Restaurants",
  "Coffee Shops",
  "Hotels",
  "Travel Agencies",
  "Event Planners",
  "Wedding Services",
  "Insurance Agencies",
  "Financial Advisors",
  "Mortgage Brokers",
  "Construction Companies",
  "Manufacturing Companies",
]

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function NicheSelector({ value, onChange, placeholder = "Search niche..." }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? NICHES.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : NICHES

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function select(niche: string) {
    onChange(niche)
    setQuery("")
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        role="combobox"
        aria-expanded={open}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-white placeholder-zinc-500 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-blue-500/30"
      >
        <input
          type="text"
          value={open ? query : value}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            if (value && !query) setQuery(value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false)
              setQuery("")
            }
          }}
          placeholder={value || placeholder}
          className="w-full bg-transparent outline-none"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-[100] w-full rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-500">No niches match</div>
          ) : (
            filtered.map((niche) => (
              <button
                key={niche}
                type="button"
                onClick={() => select(niche)}
                className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 cursor-pointer transition"
              >
                {niche}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
