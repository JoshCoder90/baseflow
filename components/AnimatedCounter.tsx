"use client"

import { useEffect, useRef, useState } from "react"

export function AnimatedCounter({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value)
  const previousValueRef = useRef(value)

  useEffect(() => {
    const start = previousValueRef.current
    const end = value

    if (start === end) return

    const duration = 400
    const stepTime = 16
    const steps = duration / stepTime
    const increment = (end - start) / steps

    let current = start

    const interval = setInterval(() => {
      current += increment

      if (
        (increment > 0 && current >= end) ||
        (increment < 0 && current <= end)
      ) {
        current = end
        clearInterval(interval)
      }

      setDisplayValue(Math.round(current))
    }, stepTime)

    previousValueRef.current = end

    return () => clearInterval(interval)
  }, [value])

  return <span>{displayValue}</span>
}
