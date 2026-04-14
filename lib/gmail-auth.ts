import type { SupabaseClient } from "@supabase/supabase-js"

/** Refresh token revoked or expired — clear stored tokens and require reconnect. */
export class GmailReconnectRequiredError extends Error {
  constructor(message = "GMAIL_RECONNECT_REQUIRED") {
    super(message)
    this.name = "GmailReconnectRequiredError"
  }
}

export function isGmailReconnectRequiredError(err: unknown): boolean {
  return err instanceof GmailReconnectRequiredError
}

export async function clearGmailTokensForReconnect(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  await supabase
    .from("gmail_connections")
    .update({
      access_token: null,
      refresh_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
}

/**
 * Refresh Google OAuth access token using refresh token.
 * Use before sending emails to avoid 401 Invalid Credentials.
 */
export async function refreshGmailAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required for token refresh")
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    if (err.includes("invalid_grant")) {
      throw new GmailReconnectRequiredError()
    }
    throw new Error(`Token refresh failed: ${res.status} ${err}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error("No access_token in refresh response")
  }

  return data.access_token
}
