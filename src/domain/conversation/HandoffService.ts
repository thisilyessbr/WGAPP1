import { SupportedLanguage } from '../faq/FaqMatcher';

export type HandoffStatus = 'BOT_ACTIVE' | 'HANDOFF_REQUESTED' | 'HUMAN_ACTIVE' | 'HUMAN_RESOLVED';

export class HandoffService {
  private static readonly HANDOFF_TRIGGERS: Record<SupportedLanguage, RegExp[]> = {
    en: [
      /\b(talk to (?:a )?human|speak to (?:an )?agent|representative|customer service|support human|real person|talk to someone|human support|live agent|human agent)\b/i,
      /\b(?:need|want) (?:a )?human\b/i
    ],
    fr: [
      /\b(parler à un humain|parler a un humain|parler à un agent|parler a un agent|service client|un conseiller|être rappelé|etre rappele|agent humain|assistance humaine)\b/i,
      /\b(parler avec (?:un )?(?:humain|agent|conseiller))\b/i
    ],
    ar: [
      /(?:تحدث مع موظف|تحدث مع إنسان|تحدث مع انسان|خدمة العملاء|موظف الدعم|أريد التحدث مع موظف|اريد التحدث مع موظف|تحدث مع عميل|شخص حقيقي|الدعم البشري)/u
    ],
    darija: [
      /(?:بدي نهضر مع شي واحد|بغيت نهضر مع شي واحد|هضر مع بنادم|تواصل مع الدعم|شي موظف|خدمة الكليان|نهضر مع إنسان|نهضر مع انسان)/u
    ]
  };

  private static readonly HANDOFF_RESPONSES: Record<SupportedLanguage, string> = {
    en: 'A human agent has been notified and will assist you shortly.',
    fr: 'Un conseiller humain a été prévenu et va prendre le relais sous peu.',
    ar: 'تم إخطار أحد موظفي خدمة العملاء وسيقوم بمساعدتك قريباً.',
    darija: 'علمنا فريق الدعم وغادي يجاوبك واحد من الموظفين قريبا.'
  };

  /**
   * Evaluates whether incoming text contains an explicit request for human handoff.
   */
  static isHandoffRequested(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    for (const regexList of Object.values(this.HANDOFF_TRIGGERS)) {
      for (const regex of regexList) {
        if (regex.test(trimmed)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Returns localized handoff acknowledgement message.
   */
  static getHandoffResponse(lang: SupportedLanguage = 'en'): string {
    return this.HANDOFF_RESPONSES[lang] || this.HANDOFF_RESPONSES.en;
  }
}
