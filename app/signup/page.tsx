"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  const handleSignup = async () => {
    setError("")
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    router.push("/login?registered=1")
  }

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[#030306] py-10 text-white">
      <div className="bf-ambient" aria-hidden>
        <div className="bf-ambient__orb bf-ambient__orb--a" />
        <div className="bf-ambient__orb bf-ambient__orb--c" />
        <div className="bf-ambient__vignette" />
      </div>
      <div className="bf-panel relative z-10 w-full max-w-md space-y-4 rounded-2xl p-8">
        <h1 className="bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-xl font-semibold text-transparent">
          Sign up
        </h1>

        <input
          type="email"
          className="w-full rounded-xl border border-white/[0.1] bg-black/30 p-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />

        <input
          type="password"
          className="w-full rounded-xl border border-white/[0.1] bg-black/30 p-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={handleSignup}
          disabled={loading}
          className="bf-btn-primary w-full rounded-xl p-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>

        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-blue-300 transition hover:text-blue-200"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
