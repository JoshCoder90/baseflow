"use client"

import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react"

type Mode = "block" | "stagger"

type Props = {
  children: ReactNode
  mode?: Mode
} & HTMLAttributes<HTMLDivElement>

/**
 * Scroll-triggered entrance: block fades up, or stagger animates `.landing-stagger-item` children.
 */
export function LandingReveal({
  children,
  className = "",
  mode = "block",
  ...rest
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (mq.matches) {
      setActive(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(true)
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -20px 0px" }
    )

    io.observe(el)
    return () => io.disconnect()
  }, [])

  const state = active ? "landing-reveal-active" : "landing-reveal-pending"
  const modeClass = mode === "stagger" ? "landing-mode-stagger" : "landing-mode-block"

  return (
    <div
      ref={ref}
      className={`landing-reveal-root ${state} ${modeClass} ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  )
}
