"use client"

import { useState } from "react"
import { createBrowserClient } from "@supabase/auth-helpers-nextjs"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const router = useRouter()

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      alert(error.message)
      return
    }

    router.push("/dashboard")
  }

  return (
    <div className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[#030306] py-10 text-white">
      <div className="bf-ambient" aria-hidden>
        <div className="bf-ambient__orb bf-ambient__orb--a" />
        <div className="bf-ambient__orb bf-ambient__orb--b" />
        <div className="bf-ambient__vignette" />
      </div>
      <div className="bf-panel relative z-10 w-full max-w-md rounded-2xl p-8">
        <h1 className="mb-6 bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-2xl font-semibold text-transparent">
          Login
        </h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded-xl border border-white/[0.1] bg-black/30 p-3.5 text-white outline-none ring-0 transition placeholder:text-zinc-500 focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-xl border border-white/[0.1] bg-black/30 p-3.5 text-white outline-none transition placeholder:text-zinc-500 focus:border-blue-500/40 focus:ring-2 focus:ring-blue-500/20"
        />

        <button
          type="button"
          onClick={handleLogin}
          className="bf-btn-primary w-full rounded-xl p-3.5 text-sm font-semibold text-white"
        >
          Login
        </button>

        <p className="mt-5 text-center text-sm text-zinc-500">
          Don&apos;t have an account? Sign up
        </p>
      </div>
    </div>
  )
}
