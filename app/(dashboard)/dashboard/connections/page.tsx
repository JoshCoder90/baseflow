"use client"

import { useCallback, useEffect, useState } from "react"
import { signIn, signOut, useSession } from "next-auth/react"
import { supabase } from "@/lib/supabase"
import {
  GMAIL_RECONNECT_REQUIRED,
  apiPayloadRequiresGmailReconnect,
} from "@/lib/gmail-reconnect-client"
import { useGmailReconnectOptional } from "@/app/providers/GmailReconnectProvider"

type SessionWithTokens = {
  accessToken?: string
  refreshToken?: string
  user?: { email?: string | null }
}

type GmailRow = {
  connected: boolean | null
  gmail_email: string | null
  access_token: string | null
  refresh_token: string | null
}

function hasOAuthTokens(row: GmailRow | null): boolean {
  if (!row) return false
  const rt = row.refresh_token
  const at = row.access_token
  return (
    (!!rt && String(rt).trim().length > 0) ||
    (!!at && String(at).trim().length > 0)
  )
}

function gmailApiIndicatesActionRequired(res: Response, data: unknown): boolean {
  if (apiPayloadRequiresGmailReconnect(data)) return true
  if (!data || typeof data !== "object") return false
  const o = data as { error?: unknown; code?: unknown }
  if (o.code === "gmail_scope") return true
  const errStr = typeof o.error === "string" ? o.error : ""
  const lower = errStr.toLowerCase()
  if (lower.includes(GMAIL_RECONNECT_REQUIRED.toLowerCase())) return true
  if (lower.includes("insufficientpermissions")) return true
  if (lower.includes("insufficient permission")) return true
  if (lower.includes("insufficient")) return true
  if (!res.ok && lower.includes("reconnect")) return true
  return false
}

export default function ConnectionsPage() {
  const { data: session, status } = useSession()
  const tokens = session as SessionWithTokens | null
  const accessToken = tokens?.accessToken
  const gmailReconnect = useGmailReconnectOptional()

  const [gmailRow, setGmailRow] = useState<GmailRow | null>(null)
  const [rowLoading, setRowLoading] = useState(true)
  const [probeActionRequired, setProbeActionRequired] = useState(false)
  const [probeDone, setProbeDone] = useState(false)

  const loadGmailRow = useCallback(async () => {
    setRowLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setGmailRow(null)
        return
      }
      const { data } = await supabase
        .from("gmail_connections")
        .select("connected, gmail_email, access_token, refresh_token")
        .eq("user_id", user.id)
        .maybeSingle()

      setGmailRow(
        data
          ? {
              connected: data.connected as boolean | null,
              gmail_email: data.gmail_email as string | null,
              access_token: data.access_token as string | null,
              refresh_token: data.refresh_token as string | null,
            }
          : null
      )
    } catch {
      setGmailRow(null)
    } finally {
      setRowLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGmailRow()
  }, [loadGmailRow])

  useEffect(() => {
    setProbeDone(false)
  }, [])

  useEffect(() => {
    if (status !== "authenticated" || !accessToken || !session?.user?.email) return
    fetch("/api/connections/gmail/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        refreshToken: tokens?.refreshToken ?? null,
        email: session.user.email,
      }),
    })
      .then(() => {
        void loadGmailRow()
        setProbeDone(false)
        setProbeActionRequired(false)
        gmailReconnect?.setGmailDisconnected(false)
      })
      .catch((err) => console.error("Failed to store Gmail tokens:", err))
  }, [
    status,
    accessToken,
    session?.user?.email,
    tokens?.refreshToken,
    loadGmailRow,
    gmailReconnect,
  ])

  const dbHealthy =
    !!gmailRow &&
    gmailRow.connected === true &&
    !!gmailRow.gmail_email?.trim() &&
    hasOAuthTokens(gmailRow)

  useEffect(() => {
    if (!dbHealthy || rowLoading) return

    let cancelled = false
    async function probe() {
      try {
        const res = await fetch("/api/sync-gmail-replies", {
          method: "GET",
          credentials: "include",
        })
        const data = (await res.json().catch(() => ({}))) as unknown
        if (cancelled) return
        if (gmailApiIndicatesActionRequired(res, data)) {
          setProbeActionRequired(true)
          gmailReconnect?.setGmailDisconnected(true)
        } else if (res.ok) {
          setProbeActionRequired(false)
          gmailReconnect?.setGmailDisconnected(false)
        }
      } catch {
        if (!cancelled) setProbeActionRequired(false)
      } finally {
        if (!cancelled) setProbeDone(true)
      }
    }

    if (!probeDone) {
      void probe()
    }
    return () => {
      cancelled = true
    }
  }, [dbHealthy, rowLoading, probeDone, gmailReconnect])

  const isConnected =
    dbHealthy &&
    !probeActionRequired &&
    !(gmailReconnect?.gmailDisconnected ?? false)

  const displayEmail =
    gmailRow?.gmail_email?.trim() ||
    (session?.user?.email as string | undefined) ||
    ""

  const handleReconnect = () => {
    signIn("google", { callbackUrl: "/dashboard/connections" })
  }

  const handleDisconnect = async () => {
    await fetch("/api/connections/gmail/disconnect", { method: "POST" })
    setProbeActionRequired(false)
    setProbeDone(false)
    gmailReconnect?.setGmailDisconnected(false)
    await loadGmailRow()
    signOut()
  }

  return (
    <div className="p-6 text-white">
      <h1 className="text-2xl font-bold mb-6">Connections</h1>

      <div className="rounded-xl border border-white/10 p-4 bg-white/5">
        <div className="flex justify-between items-center gap-4">
          <div className="min-w-0">
            <p className="text-white font-medium">Gmail</p>
            <p className="text-xs text-gray-400">
              Send and receive emails through your account
            </p>
          </div>

          <div className="shrink-0 text-right">
            {rowLoading ? (
              <span className="text-gray-400 text-sm">…</span>
            ) : isConnected ? (
              <span className="text-green-400 text-sm whitespace-nowrap">
                ● Gmail connected
              </span>
            ) : (
              <span className="text-red-400 text-sm whitespace-nowrap">
                ● Action required
              </span>
            )}
          </div>
        </div>

        {isConnected && displayEmail ? (
          <p className="text-sm text-zinc-300 mt-3 truncate" title={displayEmail}>
            {displayEmail}
          </p>
        ) : null}

        {!isConnected && !rowLoading ? (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2">
              Reconnect Gmail to enable sending emails. Make sure to allow all
              permissions.
            </p>

            <button
              type="button"
              onClick={handleReconnect}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 transition"
            >
              Reconnect Gmail
            </button>
          </div>
        ) : null}

        {isConnected ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>

      <p
        className="mt-3 text-xs text-zinc-500 cursor-help max-w-md"
        title="Required permissions: send, read, and manage emails"
      >
        Required permissions: send, read, and manage emails
      </p>
    </div>
  )
}
