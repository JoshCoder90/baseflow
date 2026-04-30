import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"

/**
 * Supabase JS v2 admin API has listUsers / getUserById but no getUserByEmail.
 * Paginate until we find a matching auth user (case-insensitive).
 */
async function getAdminUserByEmail(supabase, email) {
  if (!email || typeof email !== "string") return null
  const target = email.trim().toLowerCase()
  let page = 1
  const perPage = 200
  const maxPages = 100

  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error("[nextauth] admin.listUsers:", error.message)
      return null
    }
    const users = data?.users ?? []
    const hit = users.find(
      (u) => (u.email ?? "").trim().toLowerCase() === target
    )
    if (hit) return hit

    if (users.length === 0) break
    if (users.length < perPage) break

    const next = data?.nextPage
    page = typeof next === "number" && !Number.isNaN(next) ? next : page + 1
  }
  return null
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const access_token = account.access_token
        const refresh_token = account.refresh_token
        const email = profile?.email ?? user?.email

        console.log("Google OAuth hit:", email)

        try {
          console.log("OAuth tokens received")
          console.log("Refresh token present:", !!refresh_token)

          const { createClient } = await import("@supabase/supabase-js")
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
          )

          const supabaseUser = await getAdminUserByEmail(supabase, email)

          if (supabaseUser && email && access_token) {
            const { data: existingRow } = await supabase
              .from("gmail_connections")
              .select("refresh_token")
              .eq("user_id", supabaseUser.id)
              .maybeSingle()

            const mergedRefresh =
              refresh_token && String(refresh_token).length > 0
                ? refresh_token
                : (existingRow?.refresh_token ?? null)

            const { error } = await supabase
              .from("gmail_connections")
              .upsert({
                user_id: supabaseUser.id,
                access_token,
                refresh_token: mergedRefresh,
                gmail_email: email,
                connected: true,
                updated_at: new Date().toISOString(),
              }, { onConflict: "user_id" })

            if (error) {
              console.error("SAVE ERROR:", error)
            } else {
              console.log("Saved Gmail connection:", email)
            }
          } else {
            console.warn("OAuth: No Supabase user found for email", email, "or missing tokens - user must sign up via app first")
          }
        } catch (err) {
          console.error("OAuth signIn callback error:", err)
        }
      }
      return true
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
        if (account.refresh_token) {
          token.refreshToken = account.refresh_token
        }
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      session.refreshToken = token.refreshToken
      return session
    },
  },
}

export default NextAuth(authOptions)
