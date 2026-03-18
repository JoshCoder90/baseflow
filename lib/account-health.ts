/**
 * Single source of truth for Account Health / daily sending limits.
 * Used by both frontend UI and backend enforcement.
 */

export type AccountHealthUser = {
  created_at?: string
  gmail_connected_at?: string | null
}

export type AccountHealthResult = {
  status: "Warming Up" | "Stable" | "Healthy" | "Optimized"
  dailyLimit: number
  daysActive: number
  nextLimit: number | null
  nextUpgradeDay: number | null
  daysUntilUpgrade: number
}

export function getAccountHealth(user: AccountHealthUser | null | undefined): AccountHealthResult {
  const connectedAt = new Date(
    user?.gmail_connected_at || user?.created_at || Date.now()
  )
  const now = new Date()
  const daysActive = Math.floor(
    (now.getTime() - connectedAt.getTime()) / (1000 * 60 * 60 * 24)
  )

  let status: AccountHealthResult["status"] = "Warming Up"
  let dailyLimit = 30
  let nextLimit: number | null = 50
  let nextUpgradeDay: number | null = 7

  if (daysActive >= 7 && daysActive < 14) {
    status = "Stable"
    dailyLimit = 50
    nextLimit = 75
    nextUpgradeDay = 14
  } else if (daysActive >= 14 && daysActive < 21) {
    status = "Healthy"
    dailyLimit = 75
    nextLimit = 100
    nextUpgradeDay = 21
  } else if (daysActive >= 21) {
    status = "Optimized"
    dailyLimit = 100
    nextLimit = null
    nextUpgradeDay = null
  }

  const daysUntilUpgrade = nextUpgradeDay
    ? Math.max(0, nextUpgradeDay - daysActive)
    : 0

  return {
    status,
    dailyLimit,
    daysActive,
    nextLimit,
    nextUpgradeDay,
    daysUntilUpgrade,
  }
}
