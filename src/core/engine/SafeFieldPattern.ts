import { RE2 } from 're2-wasm';

const cache = new Map<string, RE2>();
/** Custom patterns use a linear-time engine; never fall back to native RegExp. */
export function safeFieldPattern(pattern: unknown): RE2 {
  if (typeof pattern !== 'string' || !pattern.length || pattern.length > 1024) throw new Error('INVALID_FIELD_PATTERN');
  let compiled = cache.get(pattern);
  if (!compiled) {
    compiled = new RE2(pattern, 'u');
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(pattern, compiled);
  }
  return compiled;
}
