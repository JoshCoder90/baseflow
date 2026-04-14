import { NextResponse } from "next/server"

/** Default max lengths for user-provided strings */
export const INPUT_MAX = {
  short: 200,
  medium: 4_000,
  long: 32_000,
  email: 320,
  token: 16_384,
  threadId: 512,
  placeId: 512,
} as const

const SUSPICIOUS: RegExp[] = [
  /<script/i,
  /<\/script/i,
  /javascript:/i,
  /;\s*drop\s+/i,
  /;\s*delete\s+from/i,
  /\bor\s+1\s*=\s*1\b/i,
  /'\s*;?\s*--/,
  /"\s*;?\s*--/,
]

export function hasSuspiciousPattern(value: string): boolean {
  return SUSPICIOUS.some((re) => re.test(value))
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function validateText(
  raw: unknown,
  options: { required: boolean; maxLen: number; field: string }
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  if (raw === undefined || raw === null) {
    if (options.required) {
      return { ok: false, response: badRequest(`${options.field} is required`) }
    }
    return { ok: true, value: "" }
  }
  if (typeof raw !== "string") {
    return { ok: false, response: badRequest(`${options.field} must be a string`) }
  }
  const value = raw.trim()
  if (options.required && value.length === 0) {
    return { ok: false, response: badRequest(`${options.field} cannot be empty`) }
  }
  if (value.length > options.maxLen) {
    return { ok: false, response: badRequest(`${options.field} is too long`) }
  }
  if (value.length > 0 && hasSuspiciousPattern(value)) {
    return { ok: false, response: badRequest(`${options.field} contains invalid input`) }
  }
  return { ok: true, value }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateUuid(
  raw: unknown,
  field: string
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  const t = validateText(raw, { required: true, maxLen: 36, field })
  if (!t.ok) return t
  if (!UUID_RE.test(t.value)) {
    return { ok: false, response: badRequest(`Invalid ${field}`) }
  }
  return t
}

export function validateOptionalUuid(
  raw: unknown,
  field: string
): { ok: true; value: string | null } | { ok: false; response: NextResponse } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null }
  }
  return validateUuid(raw, field)
}

/** Query/path id: non-empty trimmed string, UUID shape */
export function validateQueryUuid(
  raw: string | null,
  field: string
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  if (raw == null || !raw.trim()) {
    return { ok: false, response: badRequest(`${field} is required`) }
  }
  return validateUuid(raw.trim(), field)
}

/** OAuth tokens etc.: type + length only */
export function validateSecretString(
  raw: unknown,
  maxLen: number,
  field: string
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  if (typeof raw !== "string") {
    return { ok: false, response: badRequest(`${field} must be a string`) }
  }
  const value = raw.trim()
  if (!value.length) {
    return { ok: false, response: badRequest(`${field} is required`) }
  }
  if (value.length > maxLen) {
    return { ok: false, response: badRequest(`${field} is too long`) }
  }
  return { ok: true, value }
}

export function validateOptionalSecretString(
  raw: unknown,
  maxLen: number,
  field: string
): { ok: true; value: string | null } | { ok: false; response: NextResponse } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null }
  }
  if (typeof raw !== "string") {
    return { ok: false, response: badRequest(`${field} must be a string`) }
  }
  const value = raw.trim()
  if (!value.length) {
    return { ok: true, value: null }
  }
  if (value.length > maxLen) {
    return { ok: false, response: badRequest(`${field} is too long`) }
  }
  return { ok: true, value }
}

export function validateUuidList(
  raw: unknown,
  field: string,
  maxItems: number
): { ok: true; value: string[] } | { ok: false; response: NextResponse } {
  if (!Array.isArray(raw)) {
    return { ok: false, response: badRequest(`${field} must be an array`) }
  }
  if (raw.length === 0) {
    return { ok: false, response: badRequest(`${field} cannot be empty`) }
  }
  if (raw.length > maxItems) {
    return { ok: false, response: badRequest(`${field} is too large`) }
  }
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const v = validateUuid(raw[i], `${field}[${i}]`)
    if (!v.ok) return v
    out.push(v.value)
  }
  return { ok: true, value: out }
}

export function validateChatMessages(
  raw: unknown
):
  | { ok: true; value: { role: string; content: string }[] }
  | { ok: false; response: NextResponse } {
  if (!Array.isArray(raw)) {
    return { ok: false, response: badRequest("messages must be an array") }
  }
  if (raw.length === 0) {
    return { ok: false, response: badRequest("messages cannot be empty") }
  }
  if (raw.length > 80) {
    return { ok: false, response: badRequest("messages array is too long") }
  }
  const out: { role: string; content: string }[] = []
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i]
    if (!m || typeof m !== "object") {
      return { ok: false, response: badRequest(`messages[${i}] is invalid`) }
    }
    const roleRaw = (m as { role?: unknown }).role
    const contentRaw = (m as { content?: unknown }).content
    const r = validateText(roleRaw, {
      required: true,
      maxLen: 32,
      field: `messages[${i}].role`,
    })
    if (!r.ok) return r
    const c = validateText(contentRaw, {
      required: true,
      maxLen: INPUT_MAX.medium,
      field: `messages[${i}].content`,
    })
    if (!c.ok) return c
    if (!["user", "assistant", "system"].includes(r.value)) {
      return { ok: false, response: badRequest(`messages[${i}].role is invalid`) }
    }
    out.push({ role: r.value, content: c.value })
  }
  return { ok: true, value: out }
}

export function validatePlaceId(
  raw: unknown,
  field: string
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  return validateText(raw, {
    required: true,
    maxLen: INPUT_MAX.placeId,
    field,
  })
}

export function validateOptionalInt(
  raw: unknown,
  field: string,
  min: number,
  max: number
): { ok: true; value: number | undefined } | { ok: false; response: NextResponse } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: undefined }
  }
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return { ok: false, response: badRequest(`${field} is invalid`) }
  }
  return { ok: true, value: n }
}
