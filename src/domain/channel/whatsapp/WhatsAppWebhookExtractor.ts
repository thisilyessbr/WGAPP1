import { NormalizedWhatsAppMessage } from './types';
import { logger } from '../../../utils/logger';

export class WhatsAppWebhookExtractor {
  /**
   * Normalizes messages into durable jobs, including media and interactive replies.
   * Status updates, stickers and reactions do not initiate a chatbot turn.
   */
  static extractMessages(payload: any): NormalizedWhatsAppMessage[] {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entry)) {
      return [];
    }

    const results: NormalizedWhatsAppMessage[] = [];

    for (const entry of payload.entry) {
      if (!entry || !Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (!change || change.field !== 'messages' || !change.value) continue;

        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId || typeof phoneNumberId !== 'string') continue;

        const messages = value.messages;
        if (!Array.isArray(messages)) continue;

        const contactMap = new Map<string, string>();
        if (Array.isArray(value.contacts)) {
          for (const contact of value.contacts) {
            if (contact?.wa_id && contact?.profile?.name) {
              contactMap.set(String(contact.wa_id).trim(), String(contact.profile.name));
            }
          }
        }

        for (const msg of messages) {
          if (!msg || !msg.id || !msg.from) continue;

          const wamid = String(msg.id).trim();
          const waId = String(msg.from).trim();
          const timestamp = Number(msg.timestamp) || Math.floor(Date.now() / 1000);
          const rawType = msg.type || 'unknown';

          let message: string | undefined;
          if (rawType === 'text' && typeof msg.text?.body === 'string') {
            message = msg.text.body.trim();
          } else if (rawType === 'button' && typeof msg.button?.text === 'string') {
            message = msg.button.text.trim();
          } else if (rawType === 'interactive') {
            const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
            message = typeof reply?.title === 'string' ? reply.title.trim() : undefined;
            if (!message) message = JSON.stringify({ unsupportedMediaType: 'interactive' });
          } else if (rawType === 'image' && typeof msg.image?.id === 'string') {
            message = JSON.stringify({ mediaId: msg.image.id, caption: typeof msg.image.caption === 'string' ? msg.image.caption : '' });
          } else if (['image', 'audio', 'video', 'document', 'location', 'contacts', 'unsupported'].includes(rawType)) {
            message = JSON.stringify({ unsupportedMediaType: rawType });
          }

          if (message) {
            results.push({
              phoneNumberId: phoneNumberId.trim(),
              waId,
              wamid,
              message,
              timestamp,
              contactName: contactMap.get(waId),
              rawType: rawType === 'interactive' && !message.startsWith('{"unsupportedMediaType":') ? 'text' : rawType
            });
          } else {
            logger.info(`WhatsAppWebhookExtractor: Safely ignored non-text/unsupported message type [${rawType}] for wamid [${wamid}]`);
          }
        }
      }
    }

    return results;
  }

  /**
   * Safely extracts asynchronous delivery status receipts from Meta webhook payload.
   * Extracts sent, delivered, read, and failed events with error metadata if present.
   */
  static extractStatuses(payload: any): import('./types').NormalizedWhatsAppStatus[] {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entry)) {
      return [];
    }

    const results: import('./types').NormalizedWhatsAppStatus[] = [];

    for (const entry of payload.entry) {
      if (!entry || !Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (!change || change.field !== 'messages' || !change.value) continue;

        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId || typeof phoneNumberId !== 'string') continue;

        const statuses = value.statuses;
        if (!Array.isArray(statuses)) continue;

        for (const st of statuses) {
          if (!st || !st.id || !st.status) continue;

          const wamid = String(st.id).trim();
          const status = String(st.status).trim().toLowerCase();
          const recipientWaId = String(st.recipient_id || '').trim();
          const timestamp = Number(st.timestamp) || Math.floor(Date.now() / 1000);

          let errorCode: number | undefined;
          let errorMessage: string | undefined;

          if (Array.isArray(st.errors) && st.errors.length > 0) {
            const firstErr = st.errors[0];
            if (firstErr) {
              errorCode = typeof firstErr.code === 'number' ? firstErr.code : (Number(firstErr.code) || undefined);
              errorMessage = firstErr.message || firstErr.title || firstErr.error_data?.details || undefined;
            }
          }

          results.push({
            phoneNumberId: phoneNumberId.trim(),
            wamid,
            recipientWaId,
            status,
            timestamp,
            errorCode,
            errorMessage,
            raw: st
          });
        }
      }
    }

    return results;
  }
}

export const extractStatuses = WhatsAppWebhookExtractor.extractStatuses;
export const extractMessages = WhatsAppWebhookExtractor.extractMessages;

