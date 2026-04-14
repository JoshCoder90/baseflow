/**
 * Email discovery: homepage + /contact only (2 GETs, 2s each), mailto + regex + script/JSON text.
 * No paid APIs; no retries; no host skipping. Optional domain guesses when scrape finds nothing.
 */

import { isEmailAllowedForCampaignQueue } from "@/lib/email-queue-validation"

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/gi

const PAGE_FETCH_TIMEOUT_MS = 2000
const MAX_PAGES_PER_BUSINESS = 2

const GUESS_LOCALS = ["info", "contact", "hello", "sales"] as const

export type ScrapeEmailResult = {
  /** Scraped from page or first acceptable guess */
  email: string | null
  /** Same as email when the value came from guessing; null when scraped */
  guessedEmail: string | null
}

export function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `https://${trimmed}`
  }
  return trimmed
}

function extractRegexEmails(html: string): string[] {
  const re = new RegExp(EMAIL_REGEX.source, EMAIL_REGEX.flags)
  const matches = html.match(re) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of matches) {
    const email = raw.toLowerCase().trim()
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

function extractMailtoEmails(html: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const mailtoRe = /mailto:\s*([^"'>\s#]+)/gi
  let m: RegExpExecArray | null
  while ((m = mailtoRe.exec(html)) !== null) {
    try {
      let part = m[1].trim()
      part = decodeURIComponent(part).split("?")[0].split("&")[0].trim().toLowerCase()
      if (!part.includes("@")) continue
      const email = part.replace(/^[\s<[(]+/, "").replace(/[\s\])>]+$/, "")
      if (seen.has(email)) continue
      seen.add(email)
      out.push(email)
    } catch {
      /* ignore malformed */
    }
  }
  return out
}

/** Concatenate inline script bodies (JSON-LD, config blobs) for email patterns. */
function extractRegexEmailsFromScriptTags(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html)) !== null) {
    for (const e of extractRegexEmails(m[1])) {
      if (seen.has(e)) continue
      seen.add(e)
      out.push(e)
    }
  }
  return out
}

function passesEnrichmentKeep(email: string): boolean {
  const e = email.toLowerCase().trim()
  if (!isEmailAllowedForCampaignQueue(e)) return false
  if (e.includes("example.") || e.includes("your-domain")) return false
  if (e.endsWith(".png") || e.endsWith(".jpg") || e.endsWith(".gif")) return false
  return true
}

function firstKeepableFromHtml(html: string): string | null {
  for (const e of extractMailtoEmails(html)) {
    if (passesEnrichmentKeep(e)) return e
  }
  for (const e of extractRegexEmailsFromScriptTags(html)) {
    if (passesEnrichmentKeep(e)) return e
  }
  for (const e of extractRegexEmails(html)) {
    if (passesEnrichmentKeep(e)) return e
  }
  return null
}

function buildPriorityUrls(website: string): string[] {
  const normalized = normalizeWebsiteUrl(website)
  try {
    const u = new URL(normalized)
    const origin = `${u.protocol}//${u.host}`
    return [`${origin}/`, `${origin}/contact`]
  } catch {
    return [normalized]
  }
}

function hostnameForGuesses(website: string): string | null {
  try {
    const u = new URL(normalizeWebsiteUrl(website))
    let host = u.hostname.toLowerCase().replace(/^www\./, "")
    if (!host.includes(".")) return null
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

function firstGuessableEmail(website: string): string | null {
  const host = hostnameForGuesses(website)
  if (!host) return null
  return firstGuessableEmailForDomain(host)
}

/** Common mailbox patterns on a bare domain (e.g. after website scrape finds no address). */
export function firstGuessableEmailForDomain(domainHost: string): string | null {
  const host = domainHost.replace(/^www\./i, "").toLowerCase().trim()
  if (!host.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
  for (const local of GUESS_LOCALS) {
    const candidate = `${local}@${host}`
    if (isEmailAllowedForCampaignQueue(candidate)) return candidate.toLowerCase()
  }
  return null
}

async function fetchHtmlOnce(
  url: string,
  parentSignal?: AbortSignal
): Promise<string | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), PAGE_FETCH_TIMEOUT_MS)
  const onParent = () => ac.abort()
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer)
      return null
    }
    parentSignal.addEventListener("abort", onParent, { once: true })
  }
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BaseFlow/1.0; +https://baseflow.app)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      signal: ac.signal,
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    if (parentSignal) parentSignal.removeEventListener("abort", onParent)
  }
}

/**
 * Homepage + /contact only (max 2 GETs, 2s each). Tries mailto, script/JSON text, then full HTML regex.
 * If still empty, returns the first valid info@ / contact@ / hello@ guess for the site host.
 */
export async function scrapeEmailFromWebsite(
  website: string,
  signal?: AbortSignal
): Promise<ScrapeEmailResult> {
  const trimmed = website?.trim()
  if (!trimmed) {
    return { email: null, guessedEmail: null }
  }

  const urls = buildPriorityUrls(trimmed).slice(0, MAX_PAGES_PER_BUSINESS)

  for (const url of urls) {
    if (signal?.aborted) return { email: null, guessedEmail: null }
    const html = await fetchHtmlOnce(url, signal)
    if (!html) continue
    const found = firstKeepableFromHtml(html)
    if (found) return { email: found, guessedEmail: null }
  }

  const guessed = firstGuessableEmail(trimmed)
  if (guessed) {
    return { email: guessed, guessedEmail: guessed }
  }
  return { email: null, guessedEmail: null }
}
