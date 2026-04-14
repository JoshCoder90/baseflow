import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"

const HUNTER_DOMAIN_SEARCH = "https://api.hunter.io/v2/domain-search"

type HunterDomainSearchJson = {
  data?: { emails?: { value?: string }[] }
}

/**
 * Hunter.io domain search fallback when scraping finds no email.
 * Set `HUNTER_IO_API_KEY` in the environment; returns null if missing or on error.
 */
export async function enrichEmail(domain: string): Promise<string | null> {
  const apiKey = process.env.HUNTER_IO_API_KEY?.trim()
  const d = domain?.trim().toLowerCase().replace(/^www\./, "")
  if (!apiKey || !d || !d.includes(".")) {
    return null
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) {
    return null
  }

  try {
    const url = new URL(HUNTER_DOMAIN_SEARCH)
    url.searchParams.set("domain", d)
    url.searchParams.set("api_key", apiKey)

    const res = await fetch(url.toString(), { method: "GET" })
    if (!res.ok) return null

    const data = (await res.json()) as HunterDomainSearchJson
    const raw = data?.data?.emails?.[0]?.value
    if (typeof raw !== "string" || !raw.trim()) return null

    const email = raw.toLowerCase().trim()
    if (!isEmailAllowedForCampaignQueue(email)) return null
    return email
  } catch {
    return null
  }
}
