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
    throw new Error(`Token refresh failed: ${res.status} ${err}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error("No access_token in refresh response")
  }

  return data.access_token
}
