"use client"

import { useEffect } from "react"
import { signIn, signOut, useSession } from "next-auth/react"

export default function ConnectionsPage() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status !== "authenticated" || !session?.accessToken || !session?.user?.email) return
    fetch("/api/connections/gmail/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: (session as { refreshToken?: string }).refreshToken ?? null,
        email: session.user.email,
      }),
    }).catch((err) => console.error("Failed to store Gmail tokens:", err))
  }, [status, session?.accessToken, session?.user?.email])
  const isConnected = status === "authenticated" && !!session?.user?.email
  const email = (session?.user?.email as string) ?? ""

  return (
    <div className="p-6 text-white">
      <h1 className="text-2xl font-bold mb-6">Connections</h1>

      <div
        className="rounded-xl border border-white/10 bg-[#111] p-6 transition-all duration-300 hover:shadow-[0_0_20px_rgba(255,255,255,0.03)] hover:scale-[1.05]"
      >
        <div
          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
            isConnected ? "animate-[fadeIn_0.5s_ease-out]" : ""
          }`}
        >
          {/* Left: Icon + text stack */}
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-white/5 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-zinc-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">Gmail</p>
              {isConnected ? (
                <>
                  <p className="text-sm text-zinc-400 mt-0.5">
                    Connected and ready to send emails
                  </p>
                  <p className="text-sm font-medium text-zinc-300 mt-1.5">{email}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Emails will be sent directly from this inbox
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-400 mt-0.5">
                  Connect your Gmail to send emails
                </p>
              )}
            </div>
          </div>

          {/* Right: Status badge + button */}
          <div className="flex items-center gap-3 sm:flex-shrink-0">
            {isConnected ? (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className="relative flex h-2 w-2"
                    aria-hidden
                  >
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/30">
                    <svg
                      className="h-3 w-3"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Connected
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/connections/gmail/disconnect", { method: "POST" })
                    signOut()
                  }}
                  className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: "/dashboard/connections" })}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition"
              >
                Connect Gmail
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
