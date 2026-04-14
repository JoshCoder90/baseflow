import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  INPUT_MAX,
  validateOptionalSecretString,
  validateSecretString,
  validateText,
} from "@/lib/api-input-validation"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(req: NextRequest) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server config missing" }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const vAccess = validateSecretString(
    body.accessToken,
    INPUT_MAX.token,
    "accessToken"
  )
  if (!vAccess.ok) return vAccess.response
  const vRefresh = validateOptionalSecretString(
    body.refreshToken,
    INPUT_MAX.token,
    "refreshToken"
  )
  if (!vRefresh.ok) return vRefresh.response
  const vEmail = validateText(body.email, {
    required: true,
    maxLen: INPUT_MAX.email,
    field: "email",
  })
  if (!vEmail.ok) return vEmail.response

  const accessToken = vAccess.value
  const refreshToken = vRefresh.value
  const email = vEmail.value

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log("OAuth tokens received")
  const incomingHasRefresh = !!(refreshToken && String(refreshToken).length > 0)
  console.log("Refresh token present:", incomingHasRefresh)

  const { data: existingRow } = await supabase
    .from("gmail_connections")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle()

  const mergedRefresh =
    incomingHasRefresh && refreshToken
      ? refreshToken
      : ((existingRow?.refresh_token as string | null | undefined) ?? null)

  const { error } = await supabase
    .from("gmail_connections")
    .upsert(
      {
        user_id: user.id,
        gmail_email: email,
        access_token: accessToken,
        refresh_token: mergedRefresh,
        connected: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )

  if (error) {
    console.error("Failed to store Gmail tokens:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
