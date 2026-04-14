"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  GMAIL_RECONNECT_REQUIRED,
  apiPayloadRequiresGmailReconnect,
  isGmailReconnectRequiredClient,
  syncGmail as syncGmailRequest,
} from "@/lib/gmail-reconnect-client"

type GmailReconnectContextValue = {
  gmailDisconnected: boolean
  setGmailDisconnected: (value: boolean) => void
  /** Sets banner when `err` or JSON `error` indicates reconnect is required. Returns true if handled. */
  handlePossibleGmailReconnect: (source: unknown) => boolean
  /** Same as `syncGmail` from lib, but updates banner when reconnect is required (still rethrows). */
  syncGmail: () => Promise<void>
}

const GmailReconnectContext = createContext<GmailReconnectContextValue | null>(null)

export function GmailReconnectProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [gmailDisconnected, setGmailDisconnected] = useState(false)

  const handleReconnect = useCallback(() => {
    router.push("/dashboard/connections")
  }, [router])

  const handlePossibleGmailReconnect = useCallback((source: unknown) => {
    if (
      isGmailReconnectRequiredClient(source) ||
      apiPayloadRequiresGmailReconnect(source)
    ) {
      setGmailDisconnected(true)
      return true
    }
    return false
  }, [])

  const syncGmail = useCallback(async () => {
    try {
      await syncGmailRequest()
    } catch (err) {
      if (isGmailReconnectRequiredClient(err)) {
        setGmailDisconnected(true)
      }
      throw err
    }
  }, [])

  const value = useMemo(
    () => ({
      gmailDisconnected,
      setGmailDisconnected,
      handlePossibleGmailReconnect,
      syncGmail,
    }),
    [gmailDisconnected, handlePossibleGmailReconnect, syncGmail]
  )

  return (
    <GmailReconnectContext.Provider value={value}>
      {gmailDisconnected ? (
        <div
          role="alert"
          className="shrink-0 bg-red-500/10 border border-red-500 p-3 rounded-lg mb-4 mx-4 mt-4"
        >
          <p className="text-sm text-red-400">
            Gmail disconnected. Please reconnect to continue syncing emails.
          </p>
          <button
            type="button"
            onClick={handleReconnect}
            className="mt-2 px-4 py-2 bg-red-500 text-white rounded"
          >
            Reconnect Gmail
          </button>
        </div>
      ) : null}
      {children}
    </GmailReconnectContext.Provider>
  )
}

export function useGmailReconnect(): GmailReconnectContextValue {
  const ctx = useContext(GmailReconnectContext)
  if (!ctx) {
    throw new Error("useGmailReconnect must be used within GmailReconnectProvider")
  }
  return ctx
}

export function useGmailReconnectOptional(): GmailReconnectContextValue | null {
  return useContext(GmailReconnectContext)
}

export { GMAIL_RECONNECT_REQUIRED }
