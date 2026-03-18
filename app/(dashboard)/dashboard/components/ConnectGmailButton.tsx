"use client"

import { signIn } from "next-auth/react"

export function ConnectGmailButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/dashboard/connections" })}
      className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-600/60 bg-zinc-800/80 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700 hover:border-zinc-500 transition"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L7.455 5.91l4.546 3.409 4.546-3.409 3.527-2.417C21.69 2.28 24 3.434 24 5.457z"
        />
      </svg>
      Connect Gmail
    </button>
  )
}
