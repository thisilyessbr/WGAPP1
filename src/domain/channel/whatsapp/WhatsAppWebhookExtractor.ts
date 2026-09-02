import { NormalizedWhatsAppMessage } from './types';
import { logger } from '../../../utils/logger';

export class WhatsAppWebhookExtractor {
  /**
   * Safely extracts text messages from a Meta WhatsApp webhook payload.
   * Silently ignores unsupported event types (e.g. status updates, stickers, reactions)
   * while producing structured logs.
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

          if (rawType === 'text' && msg.text?.body && typeof msg.text.body === 'string') {
            results.push({
              phoneNumberId: phoneNumberId.trim(),
              waId,
              wamid,
              message: msg.text.body.trim(),
              timestamp,
              contactName: contactMap.get(waId),
              rawType
            });
          } else {
            logger.info(`WhatsAppWebhookExtractor: Safely ignored non-text/unsupported message type [${rawType}] for wamid [${wamid}]`);
          }
        }
      }
    }

    return results;
  }
}
