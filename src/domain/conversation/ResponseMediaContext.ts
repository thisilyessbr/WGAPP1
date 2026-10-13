import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatMedia } from './AnswerComposer';

export interface ResponseMediaContext {
  media: ChatMedia[];
}

// Response attachments belong to one turn, not to a shared engine instance.
export const responseMediaStorage = new AsyncLocalStorage<ResponseMediaContext>();
