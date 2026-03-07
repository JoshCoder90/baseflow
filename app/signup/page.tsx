"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const router = useRouter()

  const handleSignup = async () => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      return
    }

    router.push("/dashboard")
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <div className="bg-zinc-900 border border-zinc-700/50 p-8 rounded-xl w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Create Account</h1>

        <input
          type="email"
          className="w-full p-2.5 rounded-lg border border-zinc-700 bg-zinc-800 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          className="w-full p-2.5 rounded-lg border border-zinc-700 bg-zinc-800 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="button"
          onClick={handleSignup}
          className="w-full bg-blue-600 hover:bg-blue-500 p-2.5 rounded-lg font-medium transition"
        >
          Sign Up
        </button>

        <p className="text-sm text-zinc-500 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-400 hover:text-blue-300">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
