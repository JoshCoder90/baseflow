/**
 * Helpers to parse Gmail API message resources into plain text + From address.
 */

export type GmailHeader = { name?: string; value?: string }

export type GmailMessagePart = {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailMessagePart[]
}

export type GmailMessageFull = {
  id?: string
  threadId?: string
  internalDate?: string
  labelIds?: string[]
  payload?: GmailMessagePart & { headers?: GmailHeader[] }
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
  try {
    return Buffer.from(normalized + pad, "base64").toString("utf8")
  } catch {
    return ""
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function headerMap(headers: GmailHeader[] | undefined): Record<string, string> {
  const m: Record<string, string> = {}
  for (const h of headers ?? []) {
    const n = h.name?.toLowerCase()
    if (n && h.value) m[n] = h.value
  }
  return m
}

/**
 * Gmail "From" is often `"Name" <email@domain.com>`. Prefer the angle-addr;
 * otherwise use the whole header lowercased (bare `email@domain.com`).
 */
export function extractEmailFromFromHeader(fromRaw: string | undefined): string | null {
  if (!fromRaw?.trim()) return null
  const match = fromRaw.match(/<(.+?)>/)
  let raw = (match ? match[1] : fromRaw).trim().toLowerCase()
  if (!raw.includes("@")) {
    const fallback = fromRaw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    return fallback ? fallback[1].toLowerCase() : null
  }
  return raw
}

function extractBodyFromPart(part: GmailMessagePart | undefined): string {
  if (!part) return ""
  if (part.body?.data) {
    const raw = decodeBase64Url(part.body.data)
    if (part.mimeType === "text/html") return stripHtml(raw) || raw
    if (part.mimeType === "text/plain" || !part.mimeType) return raw.trim()
  }
  if (part.parts?.length) {
    let best = ""
    for (const p of part.parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        const t = decodeBase64Url(p.body.data).trim()
        if (t) return t
      }
    }
    for (const p of part.parts) {
      if (p.mimeType === "text/html" && p.body?.data) {
        const t = stripHtml(decodeBase64Url(p.body.data))
        if (t) best = t
      }
    }
    if (best) return best
    for (const p of part.parts) {
      const inner = extractBodyFromPart(p)
      if (inner) return inner
    }
  }
  return ""
}

export function plainTextBodyFromGmailMessage(msg: GmailMessageFull): string {
  const root = msg.payload
  if (!root) return ""
  return extractBodyFromPart(root).slice(0, 50000)
}
