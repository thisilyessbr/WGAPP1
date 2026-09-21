import { LLMProvider, LLMProviderError, LLMRequestOptions } from './LLMProvider';

/** A caller deadline must cancel the paid request, including any retry backoff. */
export async function generateResponseWithDeadline(
  llm: LLMProvider,
  systemPrompt: string,
  history: { role: string; content: string }[],
  options: LLMRequestOptions = {}
): Promise<string> {
  const controller = new AbortController();
  const requestedTimeout = options.timeoutMs ?? 10000;
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 30000) : 10000;
  const timeoutError = new LLMProviderError({ message: 'TIMEOUT', type: 'timeout', provider: 'llm' });
  const abort = () => controller.abort(options.signal?.reason ?? timeoutError);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: () => void = () => {};
  try {
    const deadline = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(timeoutError);
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
    });
    if (controller.signal.aborted) throw timeoutError;
    return await Promise.race([
      llm.generateResponse(systemPrompt, history, { ...options, timeoutMs, signal: controller.signal }),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
