/**
 * Instrumentation hook — no auto-processing.
 * Queue runs once per API request (/api/queue or /api/send-messages).
 */

export async function register() {
  // Queue processed on demand via API routes only
}
