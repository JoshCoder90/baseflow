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
    <div className="relative isolate flex h-full min-h-0 overflow-hidden bg-[#030306] bg-[radial-gradient(ellipse_100%_70%_at_50%_-25%,rgba(59,130,246,0.12),transparent_52%),radial-gradient(ellipse_60%_45%_at_100%_50%,rgba(139,92,246,0.06),transparent_45%)] text-white">
      <aside className="flex w-full flex-shrink-0 flex-row border-b border-white/[0.06] bg-zinc-950/85 backdrop-blur-2xl backdrop-saturate-150 lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center border-r border-white/[0.06] p-4 lg:block lg:border-r-0 lg:border-b lg:border-white/[0.06] lg:p-6">
          <Link
            href="/"
            className="bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-xl font-bold tracking-tight text-transparent hover:opacity-90"
          >
            BaseFlow
          </Link>
          <p className="mt-0.5 hidden text-xs tracking-wide text-zinc-500 lg:block">
            Automation control
          </p>
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
