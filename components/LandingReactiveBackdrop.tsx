"use client"

import { useEffect, useRef } from "react"

/** Organic wandering paths (normalized 0–1 space), seconds → x/y */
function autonomousPrimary(t: number) {
  return {
    x:
      0.48 +
      0.26 * Math.sin(t * 0.092) * Math.cos(t * 0.061) +
      0.07 * Math.sin(t * 0.173),
    y:
      0.34 +
      0.22 * Math.cos(t * 0.086) * Math.sin(t * 0.103) +
      0.055 * Math.cos(t * 0.151),
  }
}

function autonomousSecondary(t: number) {
  return {
    x:
      0.53 +
      0.21 * Math.cos(t * 0.075 + 1.15) * Math.sin(t * 0.052) +
      0.06 * Math.sin(t * 0.128),
    y:
      0.42 +
      0.19 * Math.sin(t * 0.089 - 0.72) * Math.cos(t * 0.067) +
      0.05 * Math.cos(t * 0.142),
  }
}

function clamp01(v: number, pad = 0.06) {
  return Math.min(1 - pad, Math.max(pad, v))
}

/**
 * Full-bleed ambient background for the marketing landing page:
 * self-drifting mesh + subtle mouse parallax + grain (prefers-reduced-motion aware).
 */
export function LandingReactiveBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)
  const cx = useRef(0.5)
  const cy = useRef(0.34)
  const cx2 = useRef(0.53)
  const cy2 = useRef(0.4)
  const mouseX = useRef(0.5)
  const mouseY = useRef(0.34)
  const t0Ref = useRef<number | null>(null)
  const rafRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    let reduced = motionQuery.matches

    const applyVars = () => {
      el.style.setProperty("--bf-p-x", `${cx.current * 100}%`)
      el.style.setProperty("--bf-p-y", `${cy.current * 100}%`)
      el.style.setProperty("--bf-p-x2", `${cx2.current * 100}%`)
      el.style.setProperty("--bf-p-y2", `${cy2.current * 100}%`)
    }

    const loop = (now: number) => {
      if (reduced) {
        rafRef.current = undefined
        return
      }

      if (t0Ref.current == null) t0Ref.current = now
      const t = (now - t0Ref.current) / 1000

      const a1 = autonomousPrimary(t)
      const a2 = autonomousSecondary(t)
      const mx = mouseX.current
      const my = mouseY.current

      /* Target = autonomous orbit + gentle mouse parallax (Ulio-style self motion dominates) */
      const tx1 = clamp01(a1.x + (mx - 0.5) * 0.22)
      const ty1 = clamp01(a1.y + (my - 0.5) * 0.17)
      const tx2 = clamp01(a2.x + (mx - 0.5) * 0.15)
      const ty2 = clamp01(a2.y + (my - 0.5) * 0.13)

      const ease = 0.052
      cx.current += (tx1 - cx.current) * ease
      cy.current += (ty1 - cy.current) * ease
      cx2.current += (tx2 - cx2.current) * ease
      cy2.current += (ty2 - cy2.current) * ease

      applyVars()
      rafRef.current = requestAnimationFrame(loop)
    }

    const startLoop = () => {
      if (rafRef.current != null || reduced) return
      t0Ref.current = null
      rafRef.current = requestAnimationFrame(loop)
    }

    const stopLoop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = undefined
      }
    }

    const applyReducedStatic = () => {
      cx.current = 0.5
      cy.current = 0.34
      cx2.current = 0.53
      cy2.current = 0.4
      applyVars()
    }

    if (reduced) {
      applyReducedStatic()
    } else {
      applyVars()
      startLoop()
    }

    const onMove = (e: MouseEvent) => {
      mouseX.current = e.clientX / window.innerWidth
      mouseY.current = e.clientY / window.innerHeight
    }

    const onTouch = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      mouseX.current = touch.clientX / window.innerWidth
      mouseY.current = touch.clientY / window.innerHeight
    }

    const onMotionChange = () => {
      reduced = motionQuery.matches
      stopLoop()
      t0Ref.current = null
      if (reduced) {
        applyReducedStatic()
      } else {
        startLoop()
      }
    }

    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("touchmove", onTouch, { passive: true })
    motionQuery.addEventListener("change", onMotionChange)

    return () => {
      stopLoop()
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("touchmove", onTouch)
      motionQuery.removeEventListener("change", onMotionChange)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 bg-[#030306]" />

      {/* Slow rotating aurora wash */}
      <div className="bf-landing-aurora opacity-[0.55]" aria-hidden />

      {/* Animated blobs — CSS drift layered with JS-driven glows */}
      <div className="bf-ambient__orb bf-ambient__orb--a" />
      <div className="bf-ambient__orb bf-ambient__orb--b" />
      <div className="bf-ambient__orb bf-ambient__orb--c" />

      {/* Primary glow — autonomous path + subtle mouse */}
      <div
        className="absolute inset-0 opacity-100 motion-reduce:opacity-[0.72]"
        style={{
          background:
            "radial-gradient(closest-side at var(--bf-p-x, 50%) var(--bf-p-y, 34%), rgba(59, 130, 246, 0.22), transparent 72%)",
        }}
      />
      {/* Secondary — independent autonomous orbit */}
      <div
        className="absolute inset-0 mix-blend-screen opacity-80 motion-reduce:opacity-[0.45]"
        style={{
          background:
            "radial-gradient(closest-side at var(--bf-p-x2, 53%) var(--bf-p-y2, 40%), rgba(139, 92, 246, 0.14), transparent 68%)",
        }}
      />
      {/* Cool rim — opposite combined focal bias */}
      <div
        className="absolute inset-0 opacity-50 motion-reduce:opacity-[0.28]"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at calc(100% - var(--bf-p-x, 50%)) calc(100% - var(--bf-p-y, 34%)), rgba(6, 182, 212, 0.09), transparent 58%)",
        }}
      />

      <div className="bf-ambient__grid" />
      <div className="bf-landing-noise" />
      <div className="bf-ambient__vignette" />
    </div>
  )
}
