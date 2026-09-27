import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const GROQ_V3_USD_PER_HOUR = 0.111;

export function voiceNoteChargeMicros(durationSeconds: number | null): number {
  // Groq bills at least ten seconds. An absent duration gets a conservative
  // one-minute estimate, which remains visible as UNKNOWN in the ledger.
  const billedSeconds = durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.max(10, durationSeconds) : 60;
  return Math.ceil(billedSeconds * GROQ_V3_USD_PER_HOUR * 1_000_000 / 3600);
}

/** Attribute each successful provider call to the account that received it. */
export async function recordVoiceNoteUsage(
  prisma: PrismaClient, tenantId: string, accountId: string, wamid: string, durationSeconds: number | null
): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const chargedMicros = voiceNoteChargeMicros(durationSeconds);
  const status = durationSeconds === null ? 'UNKNOWN' : 'COMPLETED';
  const metadata = JSON.stringify({ provider: 'groq', model: 'whisper-large-v3',
    durationSeconds, billedSeconds: durationSeconds === null ? 60 : Math.max(10, durationSeconds),
    priceBasis: 'USD 0.111 per audio hour, minimum 10 seconds', wamid });
  await prisma.$transaction(async db => {
    const profile = await db.portalProfile.findUnique({ where: { accountId }, select: { tenantId: true } });
    if (profile?.tenantId !== tenantId) throw new Error('VOICE_USAGE_ACCOUNT_MISMATCH');
    await db.$executeRaw`INSERT INTO "PortalUsageBucket"("accountId",period) VALUES (${accountId},${period}) ON CONFLICT DO NOTHING`;
    await db.$executeRaw`INSERT INTO "PortalUsageEntry"(id,"accountId",period,kind,"dedupeKey","chargedMicros",status,metadata)
      VALUES (${randomUUID()},${accountId},${period},'audio',${'audio:' + wamid + ':' + randomUUID()},${chargedMicros},${status},${metadata}::jsonb)`;
    await db.$executeRaw`UPDATE "PortalUsageBucket" SET "spentMicros"="spentMicros"+${chargedMicros}
      WHERE "accountId"=${accountId} AND period=${period}`;
  });
}
