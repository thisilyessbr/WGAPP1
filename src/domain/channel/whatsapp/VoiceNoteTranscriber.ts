export interface VoiceTranscript { text: string; durationSeconds: number | null; understood?: boolean; }

export class VoiceNoteTranscriber {
  constructor(
    private readonly apiKey: string | undefined = process.env.GROQ_API_KEY,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async transcribe(audio: Buffer, mimeType: string): Promise<VoiceTranscript> {
    if (!this.apiKey) throw new Error('VOICE_NOTES_UNAVAILABLE');
    if (!audio.length || audio.length > 5 * 1024 * 1024) throw new Error('INVALID_VOICE_NOTE_SIZE');
    const extension = mimeType === 'audio/ogg' ? 'ogg' : mimeType === 'audio/mpeg' ? 'mp3' : 'mp4';
    const form = new FormData();
    form.set('model', 'whisper-large-v3');
    form.set('response_format', 'verbose_json');
    form.set('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `voice-note.${extension}`);
    const response = await this.fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}` }, body: form,
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
