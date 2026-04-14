import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { rateLimitResponse } from "@/lib/rateLimit"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(req: NextRequest) {
  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  if (!supabaseServiceKey) {
    return NextResponse.json({ error: "Server config missing" }, { status: 500 })
  }

  const serverClient = await createServerClient()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  await supabase
    .from("gmail_connections")
    .delete()
    .eq("user_id", user.id)

  return NextResponse.json({ success: true })
}
