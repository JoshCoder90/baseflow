import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import {
  INPUT_MAX,
  validateOptionalUuid,
  validateText,
} from "@/lib/api-input-validation"
import { heavyRouteIpLimitResponse } from "@/lib/ip-rate-limit"
import { rateLimitResponse } from "@/lib/rateLimit"
import { sendOutboundEmailViaGmailServiceRole } from "@/lib/send-email-via-gmail"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || ""

export async function POST(req: NextRequest) {
  const _ip = heavyRouteIpLimitResponse(req, "send-email")
  if (_ip) return _ip

  const _rl = rateLimitResponse(req)
  if (_rl) return _rl

  try {
    const body = await req.json()
    const { to, subject, html, userId: bodyUserId } = body

    const rawTo = Array.isArray(to) ? to[0] : to
    const vTo = validateText(rawTo, {
      required: true,
      maxLen: INPUT_MAX.email,
      field: "to",
    })
    if (!vTo.ok) return vTo.response
    const vSub = validateText(subject, {
      required: true,
      maxLen: INPUT_MAX.medium,
      field: "subject",
    })
    if (!vSub.ok) return vSub.response
    const vHtml = validateText(html, {
      required: true,
      maxLen: INPUT_MAX.long,
      field: "html",
    })
    if (!vHtml.ok) return vHtml.response
    const vUid = validateOptionalUuid(bodyUserId, "userId")
    if (!vUid.ok) return vUid.response

    const toEmail = vTo.value

    const serverClient = await createServerClient()

    const isInternalCall = true

    if (!isInternalCall) {
      const { data: { user } } = await serverClient.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

    const { data: { user: sessionUser } } = await serverClient.auth.getUser()
    const effectiveUserId = vUid.value ?? sessionUser?.id

    if (!effectiveUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const sendResult = await sendOutboundEmailViaGmailServiceRole(supabase, {
      ownerUserId: effectiveUserId,
      toEmail,
      subject: vSub.value,
      html: vHtml.value,
    })

    if (!sendResult.ok) {
      return NextResponse.json(
        { error: sendResult.error },
        { status: sendResult.status }
      )
    }

    return NextResponse.json({
      success: true,
      threadId: sendResult.threadId,
    })
  } catch (err) {
    console.error("SEND EMAIL ERROR:", err)
    const message =
      err instanceof Error && err.message ? err.message : "Send failed"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
