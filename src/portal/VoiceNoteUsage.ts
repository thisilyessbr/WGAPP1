import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { effectiveVoiceProvider, VoiceProvider } from '../domain/channel/whatsapp/VoiceNoteTranscriber';

const GROQ_V3_MICROS_PER_HOUR = 111_000;
const DEEPGRAM_NOVA3_MICROS_PER_MINUTE = 4_300;

export function voiceNoteChargeMicros(durationSeconds: number | null, selected: VoiceProvider = 'groq'): number {
  const provider = effectiveVoiceProvider(selected);
  // Keep unknown durations visible as estimates rather than silently charging zero.
  const billedSeconds = durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? (provider === 'groq' ? Math.max(10, durationSeconds) : durationSeconds) : 60;
  return Math.ceil(provider === 'groq'
    ? billedSeconds * GROQ_V3_MICROS_PER_HOUR / 3600
    : billedSeconds * DEEPGRAM_NOVA3_MICROS_PER_MINUTE / 60);
}

/** Attribute each successful provider call to the account that received it. */
export async function recordVoiceNoteUsage(
  prisma: PrismaClient, tenantId: string, accountId: string, wamid: string, durationSeconds: number | null, selected: VoiceProvider = 'groq'
): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const chargedMicros = voiceNoteChargeMicros(durationSeconds, selected);
  const status = durationSeconds === null ? 'UNKNOWN' : 'COMPLETED';
  const groq = effectiveVoiceProvider(selected) === 'groq';
  const metadata = JSON.stringify({ provider: groq ? 'groq' : 'deepgram', model: groq ? 'whisper-large-v3' : 'nova-3-ar-MA',
    durationSeconds, billedSeconds: durationSeconds === null ? 60 : groq ? Math.max(10, durationSeconds) : durationSeconds,
    priceBasis: groq ? 'USD 0.111 per audio hour, minimum 10 seconds' : 'USD 0.0043 per audio minute, per-second billing', wamid });
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
