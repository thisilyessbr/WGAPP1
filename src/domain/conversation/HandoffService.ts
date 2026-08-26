import { SupportedLanguage } from '../faq/FaqMatcher';

export type HandoffStatus = 'BOT_ACTIVE' | 'HANDOFF_REQUESTED' | 'HUMAN_ACTIVE' | 'HUMAN_RESOLVED';

export class HandoffService {
  private static readonly HANDOFF_TRIGGERS: Record<SupportedLanguage, RegExp[]> = {
    en: [
      /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:an?\s+)?(?:human|agent|person|representative|advisor|someone|support\s+person|live\s+agent)\b/i,
      /\b(?:connect|transfer|pass)\s+(?:me\s+)?(?:to|with)\s+(?:an?\s+)?(?:human|agent|person|representative|advisor|someone|real\s+person|live\s+agent)\b/i,
      /\b(?:need|want|give\s+me)\s+(?:to\s+(?:talk|speak)\s+(?:to|with)\s+)?(?:an?\s+)?(?:human|agent|real\s+person|live\s+agent|human\s+support|human\s+representative)\b/i,
      /\b(?:talk\s+to\s+someone|human\s+agent|live\s+agent|human\s+support|real\s+person|human\s+representative)\b/i
    ],
    fr: [
      /\b(?:parler|discuter|échanger)\s+(?:à|a|avec)\s+(?:un\s+|une\s+)?(?:humain|agent|conseiller|opérateur|personne|quelqu['’]un)\b/i,
      /\b(?:passez|passer|transférez|transferer|transferez|connectez|mettre\s+en\s+relation)\s*(?:-moi|\s+moi)?\s+(?:à|a|avec)?\s*(?:un\s+|une\s+)?(?:agent|conseiller|humain|opérateur|personne)\b/i,
      /\b(?:je\s+veux|j['’]ai\s+besoin\s+d['’]|donnez-moi)\s+(?:un\s+|une\s+)?(?:humain|agent|conseiller\s+humain|personne\s+réelle|personne\s+reelle)\b/i,
      /\b(?:agent\s+humain|conseiller\s+humain|assistance\s+humaine|être\s+rappelé\s+par\s+un\s+humain)\b/i
    ],
    ar: [
      /(?:تحدث|أتحدث|اتحدث|نتحدث|أكلم|اككلم|تكلم|كلام)\s+(?:مع|بـ?)\s+(?:أحد\s+)?(?:موظفي|الموظفين|موظف|إنسان|انسان|شخص|عميل|وكيل)\b/u,
      /(?:أريد|اريد|بغيت|وددت|احتاج|أحتاج)\s+(?:ال)?(?:تحدث|حديث|كلام|تواصل)\s+مع\s+(?:أحد\s+)?(?:موظفي|الموظفين|موظف|إنسان|انسان|شخص\s+حقيقي|وكيل)/u,
      /(?:حولني|تحويل|وصلني|صلني)\s+(?:إلى|الى|لـ?)\s*(?:أحد\s+)?(?:موظفي|الموظفين|موظف|إنسان|انسان|شخص|الدعم\s+البشري|الدعم|وكيل)/u,
      /(?:موظف\s+حقيقي|شخص\s+حقيقي|الدعم\s+البشري|إنسان\s+حقيقي)/u
    ],
    darija: [
      /(?:بغيت|بدي|خليني|نقدر|واش\s+نقدر)\s+(?:نهضر|ندوي|نتكلم|نتواصل)\s+مع\s+(?:شي\s+)?(?:موظف|بنادم|إنسان|انسان|واحد\s+حقيقي|شخص)/u,
      /(?:هضر|دوي|تكلم)\s+(?:معايا|مع|بـ)\s+(?:شي\s+)?(?:بنادم|موظف|إنسان|انسان|شخص\s+حقيقي)/u,
      /(?:دوز|دوزو|عطيني|حولني)\s+(?:ليا|لي|لـ)\s*(?:شي\s+)?(?:موظف|بنادم|إنسان|مسؤول)/u,
      /\b(?:bghit|bghina|khassni|khasni|bdi)\s+(?:nhedar|nhder|nhdr|ndwi|ntkellem|ntwasel)\s+m3a\s+(?:chi\s+)?(?:agent|l-agent|conseiller|bnadm|insan|wahed|chi\s+7ed)\b/i,
      /\b(?:hedar|hder|hdr|dwi)\s+m3aya\s+(?:chi\s+)?(?:bnadm|agent|l-agent|insan|personne)\b/i,
      /\b(?:dwez|passe|passer|transferi)\s+(?:liya|lia|li)\s+(?:chi\s+)?(?:agent|l-agent|conseiller|bnadm|responsable)\b/i,
      /\b(?:parler\s+m3a\s+bnadm|hedar\s+m3a\s+bnadm)\b/i
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
