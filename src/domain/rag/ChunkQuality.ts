/**
 * Global Chunk Quality Model.
 * Deterministically classifies knowledge chunks into generic structural types
 * and provides quality scoring multipliers to enforce strict authority ordering:
 * Authoritative PDF Policy (1.25x) > Supplemental FAQ Factual Policy (1.10x) > Supplemental FAQ Example (0.85x) > Customer Examples (0.70x) > Noise (0.0x).
 */

import { DirectRagGuard } from './DirectRagGuard';

export type ChunkQualityType =
  | 'FACTUAL_POLICY'
  | 'FAQ_EXAMPLE'
  | 'CUSTOMER_EXAMPLE'
  | 'DOCUMENT_HEADER'
  | 'PAGE_LABEL'
  | 'METADATA'
  | 'INTERNAL_CONTENT'
  | 'MIXED'
  | 'LOW_VALUE';

export interface ChunkClassification {
  type: ChunkQualityType;
  isNoise: boolean;
  factualScore: number;
  qualityMultiplier: number;
  isActionable: boolean;
}

export class ChunkClassifier {
  // Patterns identifying customer inquiry example sections
  private static readonly CUSTOMER_EXAMPLE_PATTERNS = [
    /customer\s+(?:language\s+)?examples?/i,
    /sample\s+(?:questions?|prompts?|inquiries|customer\s+phrasing)/i,
    /example\s+(?:customer\s+)?(?:questions?|queries)/i,
    /أمثلة\s+(?:لأسئلة\s+الزبناء|لغة\s+الزبون|للأسئلة|الأسئلة)/u,
    /نماذج\s+أسئلة/u,
    /exemples?\s+(?:de\s+)?(?:questions?|clients?)/i
  ];

  // Patterns identifying standalone page number labels
  private static readonly PAGE_LABEL_PATTERNS = [
    /^(?:page\s+\d+|--\s*\d+\s*(?:of\s*\d+)?\s*--|.*?page\s+\d+\s*$)/i,
    /^[A-Za-z0-9\s—–-]+\s+Page\s+\d+$/i
  ];

  // Factual policy markers: bullet points, conditions, duration, prices, temperature, measurements, codes, rules, contact info
  private static readonly FACTUAL_POLICY_INDICATORS = [
    /[•\-*]\s+[A-Z\u0600-\u06FF]/u, // Bullet point lists
    /\b\d+\s*(?:days?|hours?|h|jours?|heures?|يوم(?:اً|ا)?|ساعة)\b/i, // Duration/windows
    /\b\d+\s*(?:MAD|EUR|USD|درهم|درهماً|درهمًا)\b/i, // Currency amounts
    /\b\d+\s*(?:°C|degrees|celsius|درجة)\b/i, // Temperatures
    /\b\d+\s*(?:cm|centimeters|centimètres|سم)\b/i, // Measurements
    /\b\d{1,2}:\d{2}\b/, // Hours / Timestamps (10:00, 20:00)
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email addresses
    /\b\+?\d{1,3}[\s-]?\d{3,4}[\s-]?\d{4,6}\b/, // Phone numbers
    /\b(?:code|discount|secret|fact|warranty|policy|return|delivery|shipping|refund|exchange|order|tracking|terms)\b/i,
    /\b(?:unworn|unwashed|original condition|tags attached|gentle cycle|inside out|cash on delivery|cod|tracking link|sms)\b/i,
    /\b(?:غير ملبوس|البطاقات الأصلية|الوجه الداخلي|الدفع عند الاستلام|رسالة نصية|رقم التتبع)\b/u
  ];

  /**
   * Classifies a knowledge chunk into a structural quality type.
   */
  public static classify(content: string, metadata?: any): ChunkClassification {
    const trimmed = (content || '').trim();
    if (!trimmed || trimmed.length < 15) {
      return {
        type: 'LOW_VALUE',
        isNoise: true,
        factualScore: 0.0,
        qualityMultiplier: 0.0,
        isActionable: false
      };
    }

    // 1. Internal developer / system instructions check
    if (DirectRagGuard.hasInternalArtifacts(trimmed)) {
      // Check if it's explicitly a customer example section
      if (this.CUSTOMER_EXAMPLE_PATTERNS.some(p => p.test(trimmed))) {
        return {
          type: 'CUSTOMER_EXAMPLE',
          isNoise: false, // Retained as low-priority evidence
          factualScore: 0.25,
          qualityMultiplier: 0.70,
          isActionable: false
        };
      }

      return {
        type: 'INTERNAL_CONTENT',
        isNoise: true,
        factualScore: 0.0,
        qualityMultiplier: 0.0,
        isActionable: false
      };
    }

    // 2. Pure page label detection (e.g. "Page 1", "AnimeVerse — Mock Knowledge Base Page 1")
    if (trimmed.length < 50 && this.PAGE_LABEL_PATTERNS.some(p => p.test(trimmed))) {
      return {
        type: 'PAGE_LABEL',
        isNoise: true,
        factualScore: 0.0,
        qualityMultiplier: 0.0,
        isActionable: false
      };
    }

    // 3. FAQ-derived knowledge chunk check
    const isFaqSource = metadata?.source === 'FAQ' || metadata?.isFaq || /^FAQ\s*\[/i.test(trimmed);
    if (isFaqSource) {
      const hasFactual = this.FACTUAL_POLICY_INDICATORS.some(p => p.test(trimmed));
      if (hasFactual || trimmed.length >= 60) {
        return {
          type: 'FACTUAL_POLICY',
          isNoise: false,
          factualScore: 0.90,
          qualityMultiplier: 1.10, // Supplemental factual knowledge (PDF authoritative is 1.25)
          isActionable: true
        };
      }
      return {
        type: 'FAQ_EXAMPLE',
        isNoise: false,
        factualScore: 0.75,
        qualityMultiplier: 0.85,
        isActionable: true
      };
    }

    // 4. Customer language examples section detection
    if (this.CUSTOMER_EXAMPLE_PATTERNS.some(p => p.test(trimmed))) {
      return {
        type: 'CUSTOMER_EXAMPLE',
        isNoise: false,
        factualScore: 0.25,
        qualityMultiplier: 0.70,
        isActionable: false
      };
    }

    // 5. Check for factual density indicators in standard documents
    const hasIndicator = this.FACTUAL_POLICY_INDICATORS.some(p => p.test(trimmed));

    if (hasIndicator || trimmed.length >= 40) {
      return {
        type: 'FACTUAL_POLICY',
        isNoise: false,
        factualScore: 1.0,
        qualityMultiplier: 1.25, // Authoritative PDF policy boost
        isActionable: true
      };
    }

    // 6. Short fallback chunk
    return {
      type: 'MIXED',
      isNoise: false,
      factualScore: 0.70,
      qualityMultiplier: 1.00,
      isActionable: true
    };
  }

  /**
   * Returns quality multiplier for ranking scoring.
   */
  public static getQualityMultiplier(type: ChunkQualityType): number {
    switch (type) {
      case 'FACTUAL_POLICY': return 1.25;
      case 'MIXED': return 1.00;
      case 'FAQ_EXAMPLE': return 0.85;
      case 'CUSTOMER_EXAMPLE': return 0.70;
      case 'DOCUMENT_HEADER': return 0.60;
      case 'METADATA': return 0.20;
      case 'LOW_VALUE': return 0.00;
      case 'PAGE_LABEL': return 0.00;
      case 'INTERNAL_CONTENT': return 0.00;
      default: return 1.00;
    }
  }
}
