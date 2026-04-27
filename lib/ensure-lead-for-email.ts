import type { SupabaseClient } from "@supabase/supabase-js"

function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  if (!e || !e.includes("@")) return null
  return e
}

/** Display name from a RFC5322-style From header when it differs from the address. */
export function displayNameFromFromHeader(
  fromHeader: string,
  email: string | null
): string | null {
  if (!fromHeader?.trim()) return null
  const withoutAddr = fromHeader.replace(/<[^>]+>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim()
  if (!withoutAddr) return null
  const em = email?.toLowerCase() ?? ""
  if (withoutAddr.toLowerCase() === em) return null
  return withoutAddr
}

/**
 * Returns a lead row id for this user + email, creating a minimal lead if needed.
 * Uses service or user-scoped Supabase client (caller’s RLS / service key).
 */
export async function ensureLeadIdForEmail(
  supabase: SupabaseClient,
  params: {
    email: string
    userId: string
    name?: string | null
    company?: string | null
  }
): Promise<string | null> {
  const email = normalizeEmail(params.email)
  if (!email || !params.userId) return null

  const { data: existing, error: selErr } = await supabase
    .from("leads")
    .select("id")
    .eq("email", email)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle()

  if (selErr) {
    console.error("[ensureLeadIdForEmail] select:", selErr.message)
  }
  if (existing?.id) return existing.id as string

  const { data: created, error: insErr } = await supabase
    .from("leads")
    .insert({
      user_id: params.userId,
      email,
      name: params.name?.trim() || null,
      company: params.company?.trim() || null,
      status: "pending",
    })
    .select("id")
    .single()

  if (!insErr && created?.id) return created.id as string

  if (insErr?.code === "23505" || insErr?.message?.toLowerCase().includes("duplicate")) {
    const { data: again } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .eq("user_id", params.userId)
      .limit(1)
      .maybeSingle()
    if (again?.id) return again.id as string
  }

  console.error("[ensureLeadIdForEmail] insert:", insErr?.message)
  return null
}
