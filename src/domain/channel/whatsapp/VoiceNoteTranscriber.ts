export type VoiceProvider = 'deepgram' | 'groq';
export interface VoiceTranscript { text: string; durationSeconds: number | null; understood?: boolean; }

/** Emergency rollback overrides saved account choices without changing them. */
export function effectiveVoiceProvider(selected: VoiceProvider): VoiceProvider {
  return process.env.VOICE_TRANSCRIPTION_PROVIDER === 'groq' ? 'groq' : selected;
}

export function voiceTranscriptionAvailable(provider: VoiceProvider): boolean {
  return voiceProviderConfigured(effectiveVoiceProvider(provider));
}

export function voiceProviderConfigured(provider: VoiceProvider): boolean {
  return Boolean((provider === 'deepgram' ? process.env.DEEPGRAM_API_KEY : process.env.GROQ_API_KEY)?.trim());
}

export class VoiceNoteTranscriber {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly deepgramApiKey: string | undefined = process.env.DEEPGRAM_API_KEY,
    private readonly groqApiKey: string | undefined = process.env.GROQ_API_KEY
  ) {}

  async transcribe(audio: Buffer, mimeType: string, selected: VoiceProvider, languageHint?: string): Promise<VoiceTranscript> {
    if (!audio.length || audio.length > 5 * 1024 * 1024) throw new Error('INVALID_VOICE_NOTE_SIZE');
    return effectiveVoiceProvider(selected) === 'deepgram'
      ? this.transcribeDeepgram(audio, mimeType, languageHint)
      : this.transcribeGroq(audio, mimeType);
  }

  private async transcribeDeepgram(audio: Buffer, mimeType: string, languageHint?: string): Promise<VoiceTranscript> {
    if (!this.deepgramApiKey) throw new Error('VOICE_NOTES_UNAVAILABLE');
    // Arabic is a separate model; Nova-3 multilingual supports French/English, not Arabic.
    // Use the scoped conversation/account language without making a second paid call.
    const language = languageHint === 'en' || languageHint === 'fr' ? 'multi' : 'ar-MA';
    const response = await this.fetchFn('https://api.deepgram.com/v1/listen?model=nova-3&language=' + language + '&smart_format=true', {
      method: 'POST', headers: { Authorization: `Token ${this.deepgramApiKey}`, 'Content-Type': mimeType },
      body: new Uint8Array(audio), signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) throw new Error('VOICE_TRANSCRIPTION_FAILED');
    const result = await response.json() as {
      metadata?: { duration?: unknown };
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown; confidence?: unknown }> }> }
    };
    const alternative = result.results?.channels?.[0]?.alternatives?.[0];
    const transcript = typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '';
    const duration = Number(result.metadata?.duration);
    const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
    const confidence = typeof alternative?.confidence === 'number' ? alternative.confidence : null;
    if (!transcript || transcript.length > 2000 || confidence === null || confidence < 0.5) {
      return { text: '', durationSeconds, understood: false };
    }
    return { text: transcript, durationSeconds };
  }

  private async transcribeGroq(audio: Buffer, mimeType: string): Promise<VoiceTranscript> {
    if (!this.groqApiKey) throw new Error('VOICE_NOTES_UNAVAILABLE');
    const extension = mimeType === 'audio/ogg' ? 'ogg' : mimeType === 'audio/mpeg' ? 'mp3' : 'mp4';
    const form = new FormData();
    form.set('model', 'whisper-large-v3');
    form.set('response_format', 'verbose_json');
    form.set('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `voice-note.${extension}`);
    const response = await this.fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.groqApiKey}` }, body: form,
      signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) throw new Error('VOICE_TRANSCRIPTION_FAILED');
    const result = await response.json() as { text?: unknown; duration?: unknown; language?: unknown; segments?: Array<{ end?: unknown; avg_logprob?: unknown; no_speech_prob?: unknown }> };
    const transcript = typeof result.text === 'string' ? result.text.trim() : '';
    const language = typeof result.language === 'string' ? result.language.toLowerCase() : '';
    const segments = Array.isArray(result.segments) ? result.segments : [];
    const lowConfidence = segments.length > 0 && segments.every(segment =>
      (typeof segment.avg_logprob === 'number' && segment.avg_logprob < -0.65) ||
      (typeof segment.no_speech_prob === 'number' && segment.no_speech_prob > 0.8)
    );
    const unsupportedLanguage = Boolean(language && !['arabic', 'ar', 'french', 'fr', 'english', 'en'].includes(language));
    const segmentEnd = segments.reduce((latest, segment) => Math.max(latest, Number(segment.end) || 0), 0);
    const duration = Number(result.duration) || segmentEnd;
    const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
    if (!transcript || transcript.length > 2000 || lowConfidence || unsupportedLanguage) {
      return { text: '', durationSeconds, understood: false };
    }
    return { text: transcript, durationSeconds };
  }
}
