"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const STATS = [
  { value: 2, label: "Automations Active", trend: "+2 this week", gradient: "bg-gradient-to-br from-purple-600/20 to-purple-900/20" },
  { value: 18, label: "Leads Processed Today", trend: "+12% today", gradient: "bg-gradient-to-br from-blue-600/20 to-blue-900/20" },
  { value: 18, label: "Emails Sent Today", trend: "+8% yesterday", gradient: "bg-gradient-to-br from-cyan-600/20 to-cyan-900/20" },
  { value: 20, label: "Replies This Week", trend: "+15% last week", gradient: "bg-gradient-to-br from-green-600/20 to-green-900/20" },
]

const FEB2026 = [[1,2,3,4,5,6,7],[8,9,10,11,12,13,14],[15,16,17,18,19,20,21],[22,23,24,25,26,27,28]]

const CALENDAR_STATS: Record<number, { emails: number; replies: number; meetings: number }> = {
  1: { emails: 22, replies: 2, meetings: 0 }, 2: { emails: 18, replies: 1, meetings: 1 }, 3: { emails: 22, replies: 4, meetings: 0 },
  4: { emails: 15, replies: 3, meetings: 2 }, 5: { emails: 20, replies: 2, meetings: 1 }, 6: { emails: 12, replies: 1, meetings: 0 },
  7: { emails: 20, replies: 2, meetings: 1 }, 8: { emails: 24, replies: 5, meetings: 0 }, 9: { emails: 16, replies: 2, meetings: 1 },
  10: { emails: 19, replies: 3, meetings: 2 }, 11: { emails: 14, replies: 2, meetings: 0 }, 12: { emails: 12, replies: 3, meetings: 1 },
  13: { emails: 21, replies: 4, meetings: 1 }, 14: { emails: 15, replies: 1, meetings: 0 }, 15: { emails: 18, replies: 2, meetings: 1 },
  16: { emails: 23, replies: 6, meetings: 2 }, 17: { emails: 17, replies: 2, meetings: 0 }, 18: { emails: 20, replies: 3, meetings: 1 },
  19: { emails: 14, replies: 1, meetings: 0 }, 20: { emails: 22, replies: 4, meetings: 1 }, 21: { emails: 18, replies: 2, meetings: 0 },
  22: { emails: 16, replies: 3, meetings: 2 }, 23: { emails: 19, replies: 2, meetings: 1 }, 24: { emails: 21, replies: 5, meetings: 0 },
  25: { emails: 13, replies: 1, meetings: 0 }, 26: { emails: 17, replies: 2, meetings: 1 }, 27: { emails: 20, replies: 4, meetings: 1 },
  28: { emails: 18, replies: 4, meetings: 2 },
}

const TODAYS_TASKS = [
  { title: "Call John", subtitle: "Hot Lead", icon: "phone" },
  { title: "Follow up with Sarah", subtitle: "Reply received", icon: "mail" },
  { title: "Meeting with Dental Group", subtitle: "2:30 PM", icon: "calendar" },
  { title: "Review Campaign replies", subtitle: "Campaign reviews", icon: "clipboard" },
]

const ACTIVITY_FEED = [
  { text: "Lead imported — Dental clinic list", icon: "user" },
  { text: "Email sent — Dr Smi", icon: "mail" },
]

export default function DashboardPage() {
  const pathname = usePathname()

  return (
    <div key={pathname} className="flex flex-col gap-8">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
          <p className="text-zinc-400 mt-1">Your outreach engine is running.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/campaigns"
            className="rounded-full bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 hover:border-zinc-600 transition shadow-lg shadow-black/20"
          >
            New Campaign
          </Link>
          <Link
            href="/dashboard/leads"
            className="rounded-full bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 hover:border-zinc-600 transition shadow-lg shadow-black/20"
          >
            Import Leads
          </Link>
        </div>
      </div>

      {/* 2. Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 w-full">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-2xl p-6 text-white flex flex-col gap-2 ${stat.gradient} border border-zinc-800/80`}
          >
            <span className="text-3xl font-semibold tabular-nums">{stat.value}</span>
            <span className="text-sm text-neutral-300">{stat.label}</span>
            <span className="text-xs text-emerald-400">{stat.trend}</span>
          </div>
        ))}
      </div>

      {/* 3. Active Automations + 4. Campaign Performance */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          <div className="p-6 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-white">Active Automations</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-4 rounded-xl border border-zinc-700/50 bg-zinc-800/80 p-4 hover:border-zinc-600/50 transition">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">Lead outreach sequence</p>
                <p className="text-sm text-zinc-500 mt-0.5">Sends initial email and 2 follow-ups over 7 days.</p>
                <span className="inline-flex items-center gap-1 mt-2 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Running
                </span>
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-xl border border-zinc-700/50 bg-zinc-800/80 p-4 hover:border-zinc-600/50 transition">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">Follow-up campaign</p>
                <p className="text-sm text-zinc-500 mt-0.5">Re-engages leads who opened but didn&apos;t reply.</p>
                <span className="inline-flex items-center gap-1 mt-2 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Paused
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          <div className="p-6 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-white">Campaign Performance</h2>
          </div>
          <div className="p-6 space-y-4">
            {[
              { label: "Open rate", value: "34%", color: "text-blue-400", dot: "bg-blue-400" },
              { label: "Reply rate", value: "12%", color: "text-violet-400", dot: "bg-violet-400" },
              { label: "Meetings booked", value: "4", color: "text-emerald-400", dot: "bg-emerald-400" },
              { label: "Hot leads", value: "6", color: "text-amber-400", dot: "bg-amber-400" },
            ].map((m) => (
              <div key={m.label} className="flex items-center justify-between rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                  <span className="text-sm text-zinc-300">{m.label}</span>
                </div>
                <span className={`text-sm font-semibold ${m.color}`}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Outreach Calendar + 6. Today's Tasks */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          <div className="p-6 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-white">Outreach Calendar</h2>
            <p className="text-sm text-zinc-500 mt-0.5">February 2026 — daily activity at a glance</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-zinc-500 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-3">
              {FEB2026.flat().map((day) => {
                const stats = CALENDAR_STATS[day]
                const hasActivity = stats && (stats.emails + stats.replies + stats.meetings > 0)
                return (
                  <div
                    key={day}
                    className={`rounded-lg border p-2 min-h-[72px] transition hover:bg-zinc-700/40 ${hasActivity ? "border-zinc-600/50 bg-zinc-800/70" : "border-zinc-700/40 bg-zinc-800/50"}`}
                  >
                    <p className="text-[11px] font-semibold text-zinc-300 mb-1.5">Feb {day}</p>
                    {stats ? (
                      <div className="flex flex-wrap gap-1">
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{stats.emails}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />{stats.replies}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{stats.meetings}
                        </span>
                      </div>
                    ) : (
                      <p className="text-[9px] text-zinc-600 italic">No activity</p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-zinc-700/50">
              <span className="text-xs text-zinc-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400" />Emails</span>
              <span className="text-xs text-zinc-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" />Replies</span>
              <span className="text-xs text-zinc-500 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Meetings</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          <div className="p-6 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-white">Today&apos;s Tasks</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Outreach actions for today</p>
          </div>
          <div className="p-6">
            <ul className="space-y-3">
              {TODAYS_TASKS.map((task) => (
                <li key={task.title} className="flex items-start gap-3 rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3 hover:border-zinc-600/50 hover:bg-zinc-800/80 transition cursor-pointer">
                  {task.icon === "phone" && <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg></div>}
                  {task.icon === "mail" && <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 2 0 00-2-2H5a2 2 2 0 00-2 2v10a2 2 0 002 2z" /></svg></div>}
                  {task.icon === "calendar" && <div className="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>}
                  {task.icon === "clipboard" && <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg></div>}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-semibold text-white">{task.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{task.subtitle}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 7. System Health + 8. Recent Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          <div className="p-6 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-white">System Health</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-3">
              <span className="text-sm text-zinc-300">Deliverability</span>
              <span className="text-sm font-semibold text-emerald-400">Good</span>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-3">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-zinc-300">Email usage</span>
                <span className="font-semibold text-white">98 / 1,000</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-700 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: "9.8%" }} />
              </div>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-3">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-zinc-300">SMS usage</span>
                <span className="font-semibold text-white">32 / 300</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-700 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-500" style={{ width: "10.67%" }} />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 shadow-xl shadow-black/10 overflow-hidden">
          <div className="p-6 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-white">Recent Activity</h2>
          </div>
          <div className="p-6">
            <ul className="space-y-3">
              {ACTIVITY_FEED.map((item) => (
                <li key={item.text} className="flex items-start gap-3 rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3 hover:border-zinc-600/50 transition">
                  {item.icon === "user" && <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg></div>}
                  {item.icon === "mail" && <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 2 0 00-2-2H5a2 2 2 0 00-2 2v10a2 2 0 002 2z" /></svg></div>}
                  <span className="text-sm text-zinc-300 pt-0.5">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}
