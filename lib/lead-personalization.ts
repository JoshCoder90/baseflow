/**
 * Lead personalization helpers for {{first_name}}, {{name}}, {{company}} placeholders.
 * Detects business names and uses company when appropriate.
 */

type LeadLike = { name?: string | null; company?: string | null }

const BUSINESS_KEYWORDS = [
  "llc",
  "inc",
  "ltd",
  "company",
  " co ",
  " co.",
  "services",
  "service",
  "roofing",
  "plumbing",
  "electric",
  "construction",
  "contractor",
  "group",
  "associates",
]

function looksLikeBusiness(name: string): boolean {
  const lower = name.toLowerCase()
  return BUSINESS_KEYWORDS.some((kw) => lower.includes(kw))
}

export function getFirstName(lead: LeadLike, fallback = "there"): string {
  if (!lead.name?.trim()) return fallback

  const name = lead.name.trim()

  if (looksLikeBusiness(name)) {
    const result = (lead.company ?? lead.name ?? fallback).trim()
    if (!result) return fallback
    return result.charAt(0).toUpperCase() + result.slice(1)
  }

  const first = name.split(/\s+/)[0] ?? name
  if (!first) return fallback
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

export function personalizeMessage(
  template: string,
  lead: LeadLike
): string {
  const firstName = getFirstName(lead)
  return template
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{name\}\}/gi, lead.name ?? "")
    .replace(/\{\{company\}\}/gi, lead.company ?? "")
}
