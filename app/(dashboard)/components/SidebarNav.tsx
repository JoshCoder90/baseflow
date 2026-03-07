"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"

const navBase = "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium whitespace-nowrap transition"
const navInactive = "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
const navActive = "bg-zinc-800/80 text-white border border-zinc-700/50"

export function SidebarNav() {
  const pathname = usePathname()

  const isDashboard = pathname === "/dashboard"
  const isCampaigns = pathname.startsWith("/dashboard/campaigns")
  const isAudiences = pathname.startsWith("/dashboard/audiences")
  const isLeads = pathname.startsWith("/dashboard/leads")
  const isInbox = pathname.startsWith("/dashboard/inbox")

  return (
    <nav className="flex-1 flex lg:flex-col gap-0 p-2 lg:p-4 space-y-0 lg:space-y-1 overflow-x-auto">
      <Link
        href="/dashboard"
        className={`${navBase} ${isDashboard ? navActive : navInactive}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
        Dashboard
      </Link>
      <Link
        href="/dashboard/campaigns"
        className={`${navBase} ${isCampaigns ? navActive : navInactive}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13a3 3 0 100-6M12 19h.01" /></svg>
        Campaigns
      </Link>
      <Link
        href="/dashboard/leads"
        className={`${navBase} ${isLeads ? navActive : navInactive}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        Leads
      </Link>
      <Link
        href="/dashboard/audiences"
        className={`${navBase} ${isAudiences ? navActive : navInactive}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        Audiences
      </Link>
      <Link
        href="/dashboard/inbox"
        className={`${navBase} ${isInbox ? navActive : navInactive}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        Inbox
      </Link>
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut()
          window.location.href = "/login"
        }}
        className={`${navBase} ${navInactive} mt-auto`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        Logout
      </button>
    </nav>
  )
}
