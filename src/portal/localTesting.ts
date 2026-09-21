/** Explicit, loopback-only testing mode. Never implies that an email was verified. */
export function localEmailBypass(publicUrl = process.env.PORTAL_PUBLIC_URL || 'http://localhost:3000'): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.PORTAL_DEV_SKIP_EMAIL !== 'true') return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicUrl).hostname); }
  catch { return false; }
}
