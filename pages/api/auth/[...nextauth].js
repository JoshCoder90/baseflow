import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.send",
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
          const { createClient } = await import("@supabase/supabase-js")
          const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
          )

          const { data: { user: supabaseUser } } = await supabase.auth.admin.getUserByEmail(email)

          if (supabaseUser && email && access_token) {
            const { error } = await supabase
              .from("gmail_connections")
              .upsert({
                user_id: supabaseUser.id,
                access_token,
                refresh_token: refresh_token ?? null,
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
        token.refreshToken = account.refresh_token
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
