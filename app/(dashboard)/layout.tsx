import { redirect } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getAccountHealth } from "@/lib/account-health"
import { SidebarNav } from "./components/SidebarNav"
import { AccountHealthWidget } from "./components/AccountHealthWidget"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    redirect("/login")
  }

  const user = session.user

  const { data: gmailConn } = await supabase
    .from("gmail_connections")
    .select("gmail_connected_at, created_at")
    .eq("user_id", user.id)
    .maybeSingle()

  const accountHealth = getAccountHealth({
    created_at: user?.created_at,
    gmail_connected_at:
      (gmailConn?.gmail_connected_at as string | null | undefined) ??
      (gmailConn?.created_at as string | null | undefined),
  })

  return (
    <div className="relative isolate flex h-full min-h-0 overflow-hidden bg-[#070708] bg-[radial-gradient(ellipse_90%_55%_at_50%_-15%,rgba(74,222,128,0.07),transparent_50%),radial-gradient(ellipse_55%_40%_at_100%_20%,rgba(167,139,250,0.06),transparent_48%)] text-white">
      <aside className="flex w-full flex-shrink-0 flex-row border-b border-white/[0.06] bg-[#0a0a0c]/95 backdrop-blur-2xl backdrop-saturate-150 lg:w-64 lg:flex-col lg:border-b-0 lg:border-r lg:border-white/[0.06]">
        <div className="flex items-center gap-3 border-r border-white/[0.06] p-4 lg:block lg:border-r-0 lg:border-b lg:border-white/[0.06] lg:p-6">
          <Link href="/" className="flex items-center gap-3 hover:opacity-95">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/25 to-violet-600/10 ring-1 ring-violet-400/20">
              <svg
                className="size-5 text-violet-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </span>
            <span>
              <span className="block text-lg font-bold tracking-tight text-white">
                BaseFlow
              </span>
              <span className="mt-0.5 hidden text-[11px] font-medium tracking-wide text-zinc-500 lg:block">
                Outreach workspace
              </span>
            </span>
          </Link>
        </div>
        <SidebarNav />
        <div className="mt-auto hidden flex-col space-y-2 border-t border-white/[0.06] p-4 lg:flex">
          <div className="bf-panel rounded-xl px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Plan
            </p>
            <p className="mt-0.5 text-sm font-semibold text-white">Growth</p>
          </div>
          <AccountHealthWidget data={accountHealth} />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
