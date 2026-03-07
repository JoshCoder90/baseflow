"use client"

import { useEffect, useRef, useState } from "react"
import Script from "next/script"

export type LocationValue = {
  location: string
  city: string | null
  state: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

type Props = {
  value: LocationValue | null
  onChange: (value: LocationValue | null) => void
  placeholder?: string
  id?: string
  disabled?: boolean
}

const inputBaseClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"

declare global {
  interface Window {
    google?: typeof google
  }
}

export function LocationAutocomplete({ value, onChange, placeholder = "Search for a city or address...", id, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [inputText, setInputText] = useState(value?.location ?? "")

  const apiKey = typeof process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY === "string"
    ? process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
    : undefined

  useEffect(() => {
    setInputText(value?.location ?? "")
  }, [value?.location])

  useEffect(() => {
    if (!scriptLoaded || !apiKey || !inputRef.current || typeof window.google === "undefined") return

    const g = window.google
    const autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
      types: ["geocode"],
      fields: ["place_id", "formatted_address", "geometry", "address_components"],
    })

    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace()
      if (!place.place_id || !place.geometry?.location) {
        onChange(null)
        setInputText("")
        return
      }

      const lat = place.geometry.location.lat()
      const lng = place.geometry.location.lng()
      const formatted = place.formatted_address ?? ""

      let city: string | null = null
      let state: string | null = null
      let country: string | null = null

      for (const comp of place.address_components ?? []) {
        if (comp.types.includes("locality")) city = comp.long_name
        else if (comp.types.includes("administrative_area_level_1")) state = comp.long_name
        else if (comp.types.includes("country")) country = comp.long_name
      }

      setInputText(formatted)
      onChange({
        location: formatted,
        city,
        state,
        country,
        latitude: lat,
        longitude: lng,
      })
    })

    return () => {
      g.maps.event.clearInstanceListeners(autocomplete)
    }
  }, [scriptLoaded, apiKey, onChange])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setInputText(v)
    if (!v.trim()) onChange(null)
  }

  const handleBlur = () => {
    const v = inputText.trim()
    if (!v) {
      onChange(null)
      return
    }
    if (value?.location !== v) {
      onChange({ location: v, city: null, state: null, country: null, latitude: null, longitude: null })
    }
  }

  if (!apiKey) {
    return (
      <input
        ref={inputRef}
        id={id}
        type="text"
        placeholder="Set NEXT_PUBLIC_GOOGLE_PLACES_API_KEY for autocomplete"
        value={inputText}
        onChange={(e) => {
          setInputText(e.target.value)
          const v = e.target.value.trim()
          if (v) onChange({ location: v, city: null, state: null, country: null, latitude: null, longitude: null })
          else onChange(null)
        }}
        onBlur={handleBlur}
        disabled={disabled}
        className={inputBaseClass}
      />
    )
  }

  return (
    <>
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`}
        strategy="lazyOnload"
        onLoad={() => setScriptLoaded(true)}
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        placeholder={placeholder}
        value={inputText}
        onChange={handleInputChange}
        onBlur={handleBlur}
        disabled={disabled}
        className={inputBaseClass}
        autoComplete="off"
      />
    </>
  )
}
