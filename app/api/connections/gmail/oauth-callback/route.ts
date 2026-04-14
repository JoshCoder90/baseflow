import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { rateLimitResponse } from "@/lib/rateLimit"
// @ts-expect-error NextAuth API route is implemented in JS without typings.
import { authOptions } from "@/pages/api/auth/[...nextauth]"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

type GoogleOAuthSession = {
  accessToken?: string
  refreshToken?: string
  user?: { email?: string | null }
} | null

export async function GET(req: NextRequest) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  if (!supabaseServiceKey) {
    console.error("OAuth callback: SUPABASE_SERVICE_KEY missing")
    return NextResponse.redirect(new URL("/dashboard/connections?error=config", req.url))
  }

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    console.error("OAuth callback: Supabase user not found - user must be logged in")
    return NextResponse.redirect(new URL("/dashboard/connections?error=unauthorized", req.url))
  }

  const session = (await getServerSession(authOptions as never)) as GoogleOAuthSession
  const access_token = session?.accessToken
  const email = session?.user?.email
  const refresh_token = session?.refreshToken ?? null

  if (!access_token || !email) {
    console.error("OAuth callback: No Google tokens in session")
    return NextResponse.redirect(new URL("/dashboard/connections?error=no_session", req.url))
  }

  console.log("OAuth tokens received")
  const incomingHasRefresh = !!(refresh_token && String(refresh_token).length > 0)
  console.log("Refresh token present:", incomingHasRefresh)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: existingRow } = await supabase
    .from("gmail_connections")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle()

  const mergedRefresh = incomingHasRefresh && refresh_token
    ? refresh_token
    : ((existingRow?.refresh_token as string | null | undefined) ?? null)

  const { error } = await supabase
    .from("gmail_connections")
    .upsert(
      {
        user_id: user.id,
        access_token,
        gmail_email: email,
        refresh_token: mergedRefresh,
        connected: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )

  if (error) {
    console.error("OAuth callback: Failed to save tokens:", error)
    return NextResponse.redirect(new URL("/dashboard/connections?error=save_failed", req.url))
  }

  console.log("Saved Gmail connection:", email)
  return NextResponse.redirect(new URL("/dashboard/connections", req.url))
}
