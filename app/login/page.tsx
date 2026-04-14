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
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[#0b0b0f] py-8 text-white">
      <div className="w-full max-w-md p-6 rounded-xl border border-white/10 bg-white/5">
        <h1 className="text-2xl font-semibold mb-6">Login</h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 p-3 rounded-lg bg-black/30 border border-white/10 outline-none"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 p-3 rounded-lg bg-black/30 border border-white/10 outline-none"
        />

        <button
          type="button"
          onClick={handleLogin}
          className="w-full bg-blue-600 hover:bg-blue-700 transition rounded-lg p-3 font-medium"
        >
          Login
        </button>

        <p className="text-sm text-gray-400 mt-4 text-center">
          Don&apos;t have an account? Sign up
        </p>
      </div>
    </div>
  )
}
