export const QR_CONSENT_VERSION = '2026-09-28';
export function qrEntitled(profile: any): boolean {
  return Boolean(profile?.qrAllowed && profile?.qrConsentAt && ['APPROVED','ACTIVE'].includes(profile.status)
    && profile.planSnapshot?.modules?.includes('qr'));
}
export function qrPhone(jid: string): string | null {
  if (!/^\d{7,15}(?::\d+)?@s\.whatsapp\.net$/.test(jid)) return null;
  return jid.split('@')[0].split(':')[0];
}
export function qrReconnectDelay(attempt: number): number | null {
  return attempt < 5 ? Math.min(60000,5000 * 2 ** attempt) : null;
}
