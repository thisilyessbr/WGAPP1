export interface VoiceTranscript { text: string; durationSeconds: number | null; }

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
    form.set('model', 'whisper-large-v3-turbo');
    form.set('response_format', 'verbose_json');
    form.set('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `voice-note.${extension}`);
    const response = await this.fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}` }, body: form,
      signal: AbortSignal.timeout(25_000)
    });
    if (!response.ok) throw new Error('VOICE_TRANSCRIPTION_FAILED');
    const result = await response.json() as { text?: unknown; duration?: unknown; segments?: Array<{ end?: unknown }> };
    const transcript = typeof result.text === 'string' ? result.text.trim() : '';
    if (!transcript || transcript.length > 2000) throw new Error('INVALID_VOICE_TRANSCRIPT');
    const segmentEnd = Array.isArray(result.segments)
      ? result.segments.reduce((latest, segment) => Math.max(latest, Number(segment.end) || 0), 0) : 0;
    const duration = Number(result.duration) || segmentEnd;
    return { text: transcript, durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null };
  }
}
