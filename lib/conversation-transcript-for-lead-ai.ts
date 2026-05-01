import { emailBodyToPlainPreview } from "@/lib/email-body-display"

function speakerLabel(role: string | null | undefined): "Lead" | "Rep" {
  const r = (role ?? "").toLowerCase()
  return r === "inbound" || r === "lead" ? "Lead" : "Rep"
}

function formatTranscriptLine(m: {
  role?: string | null
  content?: string | null
  created_at?: string | null
}): string | null {
  if (m.role == null || m.content == null) return null
  const plain = emailBodyToPlainPreview(String(m.content)).trim().replace(/\s+/g, " ")
  if (!plain) return null
  const who = speakerLabel(m.role)
  const ts = m.created_at ? ` (${String(m.created_at).slice(0, 16)})` : ""
  return `${who}${ts}: ${plain}`
}

/** Chronological plain-text transcript for LLM prompts (deal stage, summary, etc.). */
export function buildLeadConversationTranscript(
  messages: { role?: string | null; content?: string | null; created_at?: string | null }[]
): string {
  return (messages ?? [])
    .map((m) => formatTranscriptLine(m))
    .filter((x): x is string => Boolean(x))
    .join("\n")
}
