import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { VoiceNoteTranscriber } from '../../src/domain/channel/whatsapp/VoiceNoteTranscriber';
import { voiceNoteChargeMicros, recordVoiceNoteUsage } from '../../src/portal/VoiceNoteUsage';

const job = {
  id: 'job-1', wamid: 'wamid-1', tenantId: 'tenant-1', accountId: 'account-1',
  waId: 'customer-1', phoneNumberId: '123', rawType: 'audio',
  message: JSON.stringify({ mediaId: '987' })
} as any;

afterEach(() => vi.unstubAllEnvs());

function worker(enabled: boolean, transcribe = vi.fn(async () => ({ text: 'Bghit n7jez cours anglais', durationSeconds: 12 })), provider: 'groq' | 'deepgram' = 'groq') {
  const handleMessage = vi.fn(async () => '');
  const downloadInboundAudio = vi.fn(async () => ({ bytes: Buffer.from([1, 2]), mimeType: 'audio/ogg' }));
  const recordUsage = vi.fn(async () => {});
  const instance = new WhatsAppWorker(
    { registerHandler: () => {} } as any,
    { handleMessage } as any,
    { downloadInboundAudio } as any,
    undefined, undefined, undefined, undefined,
    { enabled: vi.fn(async () => enabled ? provider : null), transcriber: { transcribe }, recordUsage }
  );
  return { instance, handleMessage, downloadInboundAudio, transcribe, recordUsage };
}

describe('opt-in WhatsApp voice notes', () => {
  it('does not fetch or transcribe audio while the account has the option off', async () => {
    const { instance, handleMessage, downloadInboundAudio, transcribe, recordUsage } = worker(false);
    await instance.processJob(job);
    expect(downloadInboundAudio).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(handleMessage).toHaveBeenCalledWith('tenant-1', 'customer-1',
      { text: '', unsupportedMediaType: 'audio' }, 'account-1', { externalMessageId: 'wamid-1' });
  });

  it('passes the transcript into the normal chatbot using the original message ID', async () => {
    const { instance, handleMessage, downloadInboundAudio, transcribe, recordUsage } = worker(true);
    await instance.processJob(job);
    expect(downloadInboundAudio).toHaveBeenCalledWith('123', '987');
    expect(transcribe).toHaveBeenCalledWith(Buffer.from([1, 2]), 'audio/ogg', 'groq');
    expect(recordUsage).toHaveBeenCalledWith('tenant-1', 'account-1', 'wamid-1', 12, 'groq');
    expect(handleMessage).toHaveBeenCalledWith('tenant-1', 'customer-1',
      'Bghit n7jez cours anglais', 'account-1', { externalMessageId: 'wamid-1' });
  });

  it('requests text when transcription fails without processing an invented transcript', async () => {
    const { instance, handleMessage } = worker(true, vi.fn(async (): Promise<{ text: string; durationSeconds: number | null }> => { throw new Error('provider unavailable'); }));
    await instance.processJob(job);
    expect(handleMessage).toHaveBeenCalledWith('tenant-1', 'customer-1',
      { text: '', unsupportedMediaType: 'audio' }, 'account-1', { externalMessageId: 'wamid-1' });
  });

  it('downloads audio only from the trusted Meta CDN with the originating number token', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      url: 'https://lookaside.fbsbx.com/media', mime_type: 'audio/ogg; codecs=opus', file_size: 2
    }))).mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
    const adapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'test-token', fetchFn });
    expect(await adapter.downloadInboundAudio('123', '987')).toEqual({ bytes: Buffer.from([1, 2]), mimeType: 'audio/ogg' });
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('sends audio to Groq with a bounded request and returns only its text', async () => {
    vi.stubEnv('VOICE_TRANSCRIPTION_PROVIDER', 'groq');
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ text: 'Salam, bghit n7jez', duration: 12 })));
    const transcriber = new VoiceNoteTranscriber(fetchFn, undefined, 'test-groq-key');
    expect(await transcriber.transcribe(Buffer.from([1, 2]), 'audio/ogg', 'groq')).toEqual({ text: 'Salam, bghit n7jez', durationSeconds: 12 });
    expect(fetchFn.mock.calls[0][1]).toMatchObject({
      method: 'POST', headers: { Authorization: 'Bearer test-groq-key' }, signal: expect.any(AbortSignal)
    });
    expect((fetchFn.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);
    expect(((fetchFn.mock.calls[0][1] as RequestInit).body as FormData).get('model')).toBe('whisper-large-v3');
  });

  it('flags unclear transcriptions so the worker can account for the call and request a clearer note', async () => {
    vi.stubEnv('VOICE_TRANSCRIPTION_PROVIDER', 'groq');
    const weak = new VoiceNoteTranscriber(vi.fn(async () => new Response(JSON.stringify({
      text: 'garbled', language: 'arabic', segments: [{ end: 8, avg_logprob: -0.9 }]
    }))), undefined, 'test-key');
    expect(await weak.transcribe(Buffer.from([1]), 'audio/ogg', 'groq')).toEqual({ text: '', durationSeconds: 8, understood: false });
    const wrongLanguage = new VoiceNoteTranscriber(vi.fn(async () => new Response(JSON.stringify({
      text: 'unrelated words', language: 'korean'
    }))), undefined, 'test-key');
    expect(await wrongLanguage.transcribe(Buffer.from([1]), 'audio/ogg', 'groq')).toEqual({ text: '', durationSeconds: null, understood: false });
  });

  it('records an unclear transcription against the account without sending garbled text to the chatbot', async () => {
    const { instance, handleMessage, recordUsage } = worker(true, vi.fn(async () => ({ text: '', durationSeconds: 9, understood: false })));
    await instance.processJob(job);
    expect(recordUsage).toHaveBeenCalledWith('tenant-1', 'account-1', 'wamid-1', 9, 'groq');
    expect(handleMessage).toHaveBeenCalledWith('tenant-1', 'customer-1',
      { text: '', unsupportedMediaType: 'audio' }, 'account-1', { externalMessageId: 'wamid-1' });
  });

  it('uses Groq minimum billing time and an explicit unknown-duration estimate', () => {
    vi.stubEnv('VOICE_TRANSCRIPTION_PROVIDER', 'groq');
    expect(voiceNoteChargeMicros(3)).toBe(309);
    expect(voiceNoteChargeMicros(60)).toBe(1850);
    expect(voiceNoteChargeMicros(null)).toBe(1850);
  });

  it('transcribes Moroccan Arabic with Deepgram Nova-3 and bills exact seconds', async () => {
    vi.stubEnv('VOICE_TRANSCRIPTION_PROVIDER', 'deepgram');
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      metadata: { duration: 12 }, results: { channels: [{ alternatives: [{ transcript: 'بغيت نجرب حصة قبل التسجيل', confidence: 0.9 }] }] }
    })));
    const transcriber = new VoiceNoteTranscriber(fetchFn, 'test-deepgram-key');
    expect(await transcriber.transcribe(Buffer.from([1, 2]), 'audio/ogg', 'deepgram')).toEqual({ text: 'بغيت نجرب حصة قبل التسجيل', durationSeconds: 12 });
    expect(fetchFn.mock.calls[0][0]).toContain('model=nova-3&language=ar-MA');
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Token test-deepgram-key', 'Content-Type': 'audio/ogg' } });
    expect(voiceNoteChargeMicros(12, 'deepgram')).toBe(860);
  });

  it('never charges or calls a second model when Deepgram cannot understand the note', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      metadata: { duration: 20 }, results: { channels: [{ alternatives: [{ transcript: '', confidence: 0.1 }] }] }
    })));
    const transcriber = new VoiceNoteTranscriber(fetchFn, 'test-deepgram-key', 'test-groq-key');
    expect(await transcriber.transcribe(Buffer.from([1, 2]), 'audio/ogg', 'deepgram')).toEqual({ text: '', durationSeconds: 20, understood: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(voiceNoteChargeMicros(20, 'deepgram')).toBe(1434);
  });

  it('routes another account to Groq and can force a global rollback', async () => {
    const deepgram = worker(true, undefined, 'deepgram');
    await deepgram.instance.processJob(job);
    expect(deepgram.transcribe).toHaveBeenCalledWith(Buffer.from([1, 2]), 'audio/ogg', 'deepgram');
    expect(deepgram.recordUsage).toHaveBeenCalledWith('tenant-1', 'account-1', 'wamid-1', 12, 'deepgram');
    vi.stubEnv('VOICE_TRANSCRIPTION_PROVIDER', 'groq');
    expect(voiceNoteChargeMicros(12, 'deepgram')).toBe(370);
  });

  it('rejects a tenant/account mismatch before writing usage', async () => {
    const execute = vi.fn();
    const prisma = { $transaction: async (fn: any) => fn({
      portalProfile: { findUnique: async () => ({ tenantId: 'other-tenant' }) }, $executeRaw: execute
    }) } as any;
    await expect(recordVoiceNoteUsage(prisma, 'tenant-1', 'account-1', 'wamid-1', 12))
      .rejects.toThrow('VOICE_USAGE_ACCOUNT_MISMATCH');
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps voice usage writes tied to each account even for the same customer message ID', async () => {
    const execute = vi.fn(async () => 1);
    const prisma = { $transaction: async (fn: any) => fn({
      portalProfile: { findUnique: async ({ where }: any) => ({ tenantId: where.accountId === 'account-a' ? 'tenant-a' : 'tenant-b' }) },
      $executeRaw: execute
    }) } as any;
    await recordVoiceNoteUsage(prisma, 'tenant-a', 'account-a', 'same-wamid', 12);
    await recordVoiceNoteUsage(prisma, 'tenant-b', 'account-b', 'same-wamid', 20);
    expect(execute).toHaveBeenCalledTimes(6);
    for (const call of execute.mock.calls.slice(0, 3)) expect(call).toContain('account-a');
    for (const call of execute.mock.calls.slice(3)) expect(call).toContain('account-b');
  });
});
