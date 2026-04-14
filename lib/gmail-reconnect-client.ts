/** Client-side Gmail reconnect sentinel — matches API `error` and server `GmailReconnectRequiredError`. */
export const GMAIL_RECONNECT_REQUIRED = "GMAIL_RECONNECT_REQUIRED" as const

export function isGmailReconnectRequiredClient(err: unknown): boolean {
  if (err instanceof Error && typeof err.message === "string") {
    return err.message.includes(GMAIL_RECONNECT_REQUIRED)
  }
  return false
}

export function apiPayloadRequiresGmailReconnect(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false
  const err = (payload as { error?: unknown }).error
  return typeof err === "string" && err.includes(GMAIL_RECONNECT_REQUIRED)
}

/**
 * Triggers POST /api/sync-gmail-replies (same as server auto-sync).
 * Throws `Error(GMAIL_RECONNECT_REQUIRED)` when the API reports a revoked / invalid refresh token.
 */
export async function syncGmail(): Promise<void> {
  const res = await fetch("/api/sync-gmail-replies", {
    method: "POST",
    credentials: "include",
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (apiPayloadRequiresGmailReconnect(body)) {
    throw new Error(GMAIL_RECONNECT_REQUIRED)
  }
  if (!res.ok) {
    const msg =
      body &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Gmail sync failed (${res.status})`
    throw new Error(msg)
  }
}
