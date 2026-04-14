/** Always derive from current time — never reuse old timestamps. */
export function getSafeNextSendAt(offsetSeconds = 0) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString()
}
