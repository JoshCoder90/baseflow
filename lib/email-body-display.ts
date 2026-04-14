const NBSP_PATTERN = /&nbsp;|&#160;|&#x0*A0;/gi

function normalizeWhitespace(raw: string): string {
  return raw
    .replace(NBSP_PATTERN, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
}

/**
 * Prepares stored email/message body for dangerouslySetInnerHTML.
 * Replaces nbsp entities, trims excessive line breaks; plain text is escaped and broken into br tags.
 */
export function emailBodyToDisplayHtml(raw: string | null | undefined): string {
  if (raw == null || raw === "") return ""
  let s = normalizeWhitespace(String(raw))

  const hasElementTag = /<[a-z][\s\S]*>/i.test(s)
  if (hasElementTag) {
    s = s.replace(/<script\b[\s\S]*?<\/script>/gi, "")
    s = s.replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    return s.trim()
  }

  return s
    .replace(/[ \t]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br />")
    .replace(/(<br \/>){3,}/gi, "<br /><br />")
}

/** One-line preview for sidebars (no HTML). */
export function emailBodyToPlainPreview(raw: string | null | undefined, maxLen = 160): string {
  if (raw == null || raw === "") return "—"
  let s = normalizeWhitespace(String(raw))
    .replace(/<[^>]*>/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
  if (s.length <= maxLen) return s || "—"
  return `${s.slice(0, maxLen)}…`
}
