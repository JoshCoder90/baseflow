import { redirect } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { SidebarNav } from "./components/SidebarNav"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  return (
    <div className="h-screen min-h-0 flex bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <aside className="w-full lg:w-64 flex-shrink-0 bg-zinc-900/98 border-b lg:border-b-0 lg:border-r border-zinc-800/80 flex flex-row lg:flex-col">
        <div className="p-4 lg:p-6 border-b-0 lg:border-b border-r lg:border-r-0 border-zinc-800/80 flex items-center lg:block">
          <Link href="/" className="text-xl font-bold tracking-tight text-white hover:opacity-90">
            BaseFlow
          </Link>
          <p className="hidden lg:block text-xs text-zinc-500 mt-0.5 tracking-wide">Automation control</p>
        </div>
        <SidebarNav />
        <div className="hidden lg:flex p-4 space-y-2 border-t border-zinc-800 flex-col">
          <div className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Plan</p>
            <p className="text-sm font-semibold text-white mt-0.5">Growth</p>
          </div>
          <div className="rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/30">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Health</p>
            <p className="text-sm font-semibold text-emerald-400 mt-0.5">Good</p>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 min-h-0 overflow-y-auto px-8 py-8">
          <div className="w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}