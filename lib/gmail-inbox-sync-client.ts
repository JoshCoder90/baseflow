/**
 * Client-only: pull Gmail → CRM so inbound replies appear in inbox without a background worker.
 * Uses GET /api/sync-gmail-replies (no POST cooldown).
 */
export async function runGmailInboxSync(): Promise<{
  ok: boolean
  imported?: number
  skipped?: boolean
}> {
  try {
    const res = await fetch("/api/sync-gmail-replies", {
      method: "GET",
      credentials: "include",
    })
    const data = (await res.json().catch(() => ({}))) as {
      imported?: number
      skipped?: boolean
    }
    return {
      ok: res.ok,
      imported: data.imported,
      skipped: data.skipped === true,
    }
  } catch {
    return { ok: false }
  }
}
