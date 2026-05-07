"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Plug } from "lucide-react"
import { supabase } from "@/lib/supabase"

const navBase =
  "flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition duration-200"
const navInactive =
  "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
const navActive =
  "bg-white/[0.07] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset] ring-1 ring-white/[0.08]"
const navIcon =
  "text-violet-400/90 group-[.is-active]:text-white"

/** Unread = latest inbound time is newer than last_read_at (outbound does not affect this). */
function unreadInboundCount(
  rows: { last_inbound_at?: unknown; last_read_at?: unknown }[] | null
): number {
  return (rows ?? []).filter((c) => {
    const at = c.last_inbound_at
    if (at == null || String(at).length === 0) return false
    return (
      new Date(String(at)).getTime() >
      new Date((c.last_read_at as string | null) || 0).getTime()
    )
  }).length
}

export function SidebarNav() {
  const pathname = usePathname() ?? ""
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    let channel: ReturnType<typeof supabase.channel> | null = null

    const fetchUnread = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setUnreadCount(0)
        return
      }

      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", user.id)

      if (cancelled) return
      if (error) {
        console.warn("[SidebarNav] conversations:", error.message)
        return
      }

      setUnreadCount(unreadInboundCount(data ?? []))
    }

    async function setup() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled || !user) return

      await fetchUnread()

      const schedule = () => {
        clearTimeout(debounce)
        debounce = setTimeout(() => {
          void fetchUnread()
        }, 400)
      }

      channel = supabase
        .channel(`sidebar-inbox-unread-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `user_id=eq.${user.id}`,
          },
          schedule
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          schedule
        )
        .subscribe()
    }

    void setup()

    return () => {
      cancelled = true
      clearTimeout(debounce)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!pathname.startsWith("/dashboard/inbox")) return

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setUnreadCount(0)
        return
      }
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", user.id)
      if (error) return
      setUnreadCount(unreadInboundCount(data ?? []))
    })()
  }, [pathname])

  const isDashboard = pathname === "/dashboard"
  const isCampaigns = pathname.startsWith("/dashboard/campaigns")
  const isLeads = pathname.startsWith("/dashboard/leads")
  const isInbox = pathname.startsWith("/dashboard/inbox")
  const isConnections = pathname.startsWith("/dashboard/connections")

  return (
    <nav className="flex-1 flex lg:flex-col gap-0 p-2 lg:p-4 space-y-0 lg:space-y-1 overflow-x-auto">
      <Link
        href="/dashboard"
        className={`group ${navBase} ${isDashboard ? `is-active ${navActive}` : navInactive}`}
      >
        <svg className={`w-4 h-4 ${navIcon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
        Dashboard
      </Link>
      <Link
        href="/dashboard/campaigns"
        className={`group ${navBase} ${isCampaigns ? `is-active ${navActive}` : navInactive}`}
      >
        <svg className={`w-4 h-4 ${navIcon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13a3 3 0 100-6M12 19h.01" /></svg>
        Campaigns
      </Link>
      <Link
        href="/dashboard/leads"
        className={`group ${navBase} ${isLeads ? `is-active ${navActive}` : navInactive}`}
      >
        <svg className={`w-4 h-4 ${navIcon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        Leads
      </Link>
      <Link
        href="/dashboard/inbox"
        className={`group ${navBase} w-full ${isInbox ? `is-active ${navActive}` : navInactive}`}
      >
        <div className="flex w-full items-center justify-between">
          <span className="flex items-center gap-3">
            <svg className={`w-4 h-4 shrink-0 ${navIcon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Inbox
          </span>
          {unreadCount > 0 && (
            <div className="ml-2 shrink-0 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-950 shadow-[0_0_14px_-2px_rgba(52,211,153,0.55)]">
              {unreadCount}
            </div>
          )}
        </div>
      </Link>
      <Link
        href="/dashboard/connections"
        className={`group ${navBase} ${isConnections ? `is-active ${navActive}` : navInactive}`}
      >
        <Plug className={`w-4 h-4 ${navIcon}`} strokeWidth={2} />
        Connections
      </Link>
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut()
          window.location.href = "/"
        }}
        className={`group ${navBase} ${navInactive} mt-auto`}
      >
        <svg className={`w-4 h-4 ${navIcon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        Logout
      </button>
    </nav>
  )
}
