import { redirect } from "next/navigation"
import Link from "next/link"
import { LandingReactiveBackdrop } from "@/components/LandingReactiveBackdrop"
import { LandingReveal } from "@/components/LandingReveal"
import { getUser } from "@/lib/auth"

function Check() {
  return (
    <svg
      className="mt-0.5 size-4 shrink-0 text-blue-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

export default async function Home() {
  const user = await getUser()
  if (user) {
    redirect("/dashboard")
  }

  return (
    <main className="relative isolate flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden bg-transparent text-zinc-100 selection:bg-blue-600/25">
      <LandingReactiveBackdrop />

      <div className="relative z-[2] flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-[#0a1428]/80 backdrop-blur-xl backdrop-saturate-100">
        <p className="landing-hero-in landing-hero-d0 border-b border-white/[0.04] py-2.5 text-center text-[11px] font-medium uppercase tracking-[0.3em] text-zinc-600">
          Built for teams running cold email at scale
        </p>
        <div className="landing-hero-in landing-hero-d1 mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <span className="text-lg font-semibold tracking-tight text-white">
            BaseFlow
          </span>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.07] hover:text-white"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="bf-btn-primary inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold text-white"
            >
              Start free trial
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 pb-24 pt-14 sm:px-6 sm:pb-28 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="flex flex-col">
            <p className="landing-hero-in landing-hero-d0 inline-flex w-fit items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.26em] text-zinc-400">
              Autopilot for your inbox
            </p>
            <h1 className="landing-display-head landing-hero-in landing-hero-d1 mt-8 max-w-[22ch] text-balance sm:max-w-none">
              <span className="block text-[clamp(2.1rem,5vw,3.75rem)] font-semibold leading-[1.04] text-white">
                Close leads from cold outreach
              </span>
              <span className="mt-2 block text-[clamp(2.1rem,5vw,3.75rem)] font-semibold leading-[1.04]">
                <span className="bg-gradient-to-b from-zinc-100 via-white to-sky-200/90 bg-clip-text text-transparent [text-shadow:0_0_80px_rgba(59,130,246,0.12)]">
                  without doing the work.
                </span>
              </span>
            </h1>
            <p className="landing-hero-in landing-hero-d2 mt-8 max-w-lg text-[17px] font-normal leading-relaxed text-zinc-500 sm:text-lg">
              BaseFlow turns replies into booked calls with AI. You run the
              send — we run the back-and-forth until a meeting is on the
              calendar.
            </p>
            <div className="landing-hero-in landing-hero-d3 mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="bf-btn-primary inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-semibold text-white"
              >
                Start free trial
              </Link>
              <a
                href="#product-preview"
                className="inline-flex items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.04] px-7 py-3 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.05)_inset] transition hover:border-white/25 hover:bg-white/[0.08]"
              >
                Watch demo
              </a>
            </div>
            <p className="landing-hero-in landing-hero-d4 mt-6 text-xs font-medium tracking-wide text-zinc-500">
              No card required to explore · Connect Gmail in minutes
            </p>
          </div>

            <div
            className="bf-surface landing-hero-in landing-hero-d5 relative overflow-hidden rounded-2xl border-white/[0.07] p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_32px_80px_-36px_rgba(0,0,0,0.85)] sm:p-5"
            aria-label="Inbox preview"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-3">
              <span className="text-xs font-medium text-zinc-500">Inbox</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-300/90">
                <span className="bf-live-dot size-1.5 rounded-full bg-emerald-400" />
                Live
              </span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                {(
                  [
                    {
                      name: "Apex Roofing Co.",
                      preview: "Thanks for reaching out — are you free Tue?",
                    },
                    {
                      name: "Summit HVAC",
                      preview: "Interested. What does setup look like?",
                    },
                    {
                      name: "Pioneer Services LLC",
                      preview: "Can we book a 15 min call this week?",
                    },
                    {
                      name: "Northline Concrete",
                      preview: "Send over pricing when you can.",
                    },
                  ] as const
                ).map((row) => (
                  <div
                    key={row.name}
                    className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5 transition hover:border-white/12 hover:bg-white/[0.04]"
                  >
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.65)]"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">
                        {row.name}
                      </p>
                      <p className="truncate text-xs text-zinc-500 group-hover:text-zinc-400">
                        {row.preview}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex w-full flex-col justify-start gap-2 sm:w-44 sm:shrink-0 sm:border-l sm:border-white/[0.06] sm:pl-4">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  AI suggestions
                </p>
                {(
                  [
                    "Propose 2:30 PM",
                    "Qualify + ask budget",
                    "Move to call",
                  ] as const
                ).map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="w-full cursor-default rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-left text-xs font-medium text-zinc-200 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] transition hover:border-blue-500/30 hover:bg-blue-500/10"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <LandingReveal mode="stagger" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <p className="landing-stagger-item text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            How it works
          </p>
          <h2 className="landing-stagger-item landing-display-head mt-4 max-w-3xl text-[clamp(1.85rem,4vw,2.75rem)] font-semibold leading-[1.12] tracking-tight text-balance text-white">
            One pipeline. Three moves.
            <span className="mt-2 block text-zinc-400 sm:mt-3 sm:text-[clamp(1.5rem,3vw,2.1rem)] sm:leading-snug">
              No extra tools. No hand-holding.
            </span>
          </h2>

            {(
              [
                {
                  n: "01",
                  t: "Find leads",
                  s: "Scrape 200 targeted prospects instantly and keep the list fresh.",
                },
                {
                  n: "02",
                  t: "Send campaigns",
                  s: "Launch cold outreach from Gmail with guardrails and tracking built in.",
                },
                {
                  n: "03",
                  t: "Close with AI",
                  s: "Replies are drafted, nudged, and threaded until a call is booked — automatically.",
                },
              ] as const
            ).map((step) => (
              <div
                key={step.n}
                className={`landing-stagger-item bf-surface group flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-6 ${step.n === "01" ? "mt-10" : "mt-4"}`}
              >
                <div className="flex w-20 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-black/40 px-3 py-2 font-mono text-sm font-bold tabular-nums text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]">
                  {step.n}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-white">{step.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                    {step.s}
                  </p>
                </div>
              </div>
            ))}
      </LandingReveal>

      <LandingReveal className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <h2 className="landing-display-head mx-auto max-w-3xl text-center text-[clamp(1.75rem,3.8vw,2.65rem)] font-semibold leading-snug tracking-tight text-balance text-white">
            Turn cold outreach into booked calls —{" "}
            <span className="bg-gradient-to-r from-blue-100 to-white bg-clip-text text-transparent">
              automatically
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-sm font-medium text-zinc-500">
            Outcomes teams report in the first 14 days on BaseFlow.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4">
            {(
              [
                "Booked 27 calls in 2 days",
                "Saved 15+ hours per week",
                "Closed $8k client from AI reply",
              ] as const
            ).map((t) => (
              <div
                key={t}
                className="bf-surface flex justify-center rounded-2xl px-5 py-3.5 text-center text-sm font-semibold text-zinc-100"
              >
                {t}
              </div>
            ))}
          </div>
      </LandingReveal>

      <LandingReveal className="mx-auto max-w-6xl px-4 py-24 sm:px-6" id="product-preview">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            In the app
          </p>
          <h2 className="landing-display-head mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">
            Everything you need to run one campaign end-to-end
          </h2>
          <div className="bf-surface mt-10 max-w-3xl rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Campaign
                </p>
                <p className="mt-1.5 text-xl font-bold text-white sm:text-2xl">
                  Roofing Leads
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Leads
                </p>
                <p className="mt-1.5 text-lg font-semibold tabular-nums text-white">
                  200/200
                </p>
              </div>
              <div className="sm:self-start">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-600/30 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-blue-500">
                  <span
                    className="size-1.5 rounded-full bg-blue-600"
                    aria-hidden
                  />
                  Active
                </span>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {(
                [
                  "AI Suggested Replies",
                  "Real-time scraping",
                  "Smart follow-ups",
                ] as const
              ).map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-white/10 bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-zinc-300"
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-8 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-1.5 w-[44%] rounded-full bg-blue-600"
                aria-hidden
              />
            </div>
            <p className="mt-2.5 text-xs text-zinc-500">Outreach in progress</p>
          </div>
      </LandingReveal>

      <LandingReveal className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                The edge
              </p>
              <h2 className="landing-display-head mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Why BaseFlow
              </h2>
            </div>
            <ul className="space-y-4 lg:col-span-7 lg:pl-2">
              {(
                [
                  "Built for cold outreach agencies",
                  "Works with your Gmail",
                  "No complicated setup",
                  "Actually closes leads",
                ] as const
              ).map((line) => (
                <li
                  key={line}
                  className="flex gap-3 pl-1 text-sm leading-relaxed text-zinc-400 sm:text-base"
                >
                  <span
                    className="mt-2.5 size-1.5 shrink-0 rounded-full bg-blue-600"
                    aria-hidden
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>
      </LandingReveal>

      <LandingReveal className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Pricing
          </p>
          <h2 className="landing-display-head mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Simple pricing. No surprises.
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-zinc-400">
            Start small. Scale when the pipeline justifies it.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <div className="bf-surface flex flex-col rounded-2xl p-8">
              <h3 className="text-lg font-semibold text-white">Starter</h3>
              <p className="mt-1 text-4xl font-bold tabular-nums text-white">
                $99
                <span className="text-base font-medium text-zinc-500">/mo</span>
              </p>
              <p className="mt-1 text-sm text-zinc-500">For a single rep inbox</p>
              <ul className="mt-8 space-y-3 text-sm text-zinc-400">
                <li className="flex gap-2.5">
                  <Check />
                  1 inbox
                </li>
                <li className="flex gap-2.5">
                  <Check />
                  Full campaigns
                </li>
                <li className="flex gap-2.5">
                  <Check />
                  AI replies
                </li>
              </ul>
            </div>
            <div className="relative flex flex-col overflow-hidden rounded-2xl border border-blue-500/40 bg-gradient-to-b from-blue-500/10 via-zinc-950/80 to-zinc-950 p-8 shadow-[0_0_60px_-12px_rgba(59,130,246,0.35)]">
              <div className="pointer-events-none absolute inset-0 rounded-2xl [background:linear-gradient(105deg,transparent_40%,rgba(255,255,255,0.06)_50%,transparent_60%)] bg-[length:200%_100%] [animation:bfShimmer_5s_ease-in-out_infinite]" />
              <div className="absolute right-5 top-5 z-[2]">
                <span className="rounded-md border border-blue-500/35 bg-black/40 px-2.5 py-0.5 text-xs font-semibold text-blue-300 backdrop-blur-sm">
                  Most popular
                </span>
              </div>
              <div className="relative z-[1]">
                <h3 className="text-lg font-semibold text-white">Growth</h3>
                <p className="mt-1 text-4xl font-bold tabular-nums text-white">
                  $199
                  <span className="text-base font-medium text-zinc-500">/mo</span>
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  For teams that ship volume
                </p>
                <ul className="mt-8 space-y-3 text-sm text-zinc-300">
                  <li className="flex gap-2.5">
                    <Check />
                    Unlimited campaigns
                  </li>
                  <li className="flex gap-2.5">
                    <Check />
                    Advanced AI models
                  </li>
                  <li className="flex gap-2.5">
                    <Check />
                    Priority sending
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <p className="mt-8 text-center text-sm text-zinc-500">
            Cancel anytime · keep your data
          </p>
      </LandingReveal>

      <LandingReveal className="px-4 py-24 sm:px-6">
        <div className="bf-surface mx-auto max-w-4xl rounded-2xl px-6 py-16 text-center sm:px-8 sm:py-16">
          <h2 className="landing-display-head text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Stop chasing leads.{" "}
            <span className="bg-gradient-to-r from-white to-blue-100/90 bg-clip-text text-transparent">
              Start closing them.
            </span>
          </h2>
          <p className="mt-3 text-sm text-zinc-500">
            Join teams who use BaseFlow to turn cold outreach into revenue.
          </p>
          <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-3">
            <Link
              href="/signup"
              className="bf-btn-primary inline-flex w-full items-center justify-center rounded-full px-8 py-3 text-sm font-semibold text-white sm:w-auto"
            >
              Start free trial
            </Link>
            <span className="text-xs text-zinc-500">Takes a few minutes</span>
          </div>
        </div>
      </LandingReveal>

      <footer className="mt-auto py-10">
        <p className="text-center text-sm text-zinc-500">© BaseFlow</p>
      </footer>
      </div>
    </main>
  )
}
