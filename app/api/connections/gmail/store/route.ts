import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(req: NextRequest) {
  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server config missing" }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const accessToken = body.accessToken as string | undefined
  const refreshToken = body.refreshToken as string | null | undefined
  const email = body.email as string | undefined

  if (!accessToken || !email) {
    return NextResponse.json({ error: "Missing accessToken or email" }, { status: 400 })
  }

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { error } = await supabase
    .from("gmail_connections")
    .upsert(
      {
        user_id: user.id,
        gmail_email: email,
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
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
