import { describe, it, expect } from 'vitest';
import { LanguageDetector, FaqMatcher } from '../domain/faq/FaqMatcher';
import { FaqEntry } from '../domain/tenant/BusinessConfig';

describe('LanguageDetector', () => {
  it('detects English', () => {
    expect(LanguageDetector.detect('What are your business hours?')).toBe('en');
    expect(LanguageDetector.detect('how much is the starter plan')).toBe('en');
  });

  it('detects French', () => {
    expect(LanguageDetector.detect("Quels sont vos horaires d'ouverture?")).toBe('fr');
    expect(LanguageDetector.detect('combien coute le forfait')).toBe('fr');
    expect(LanguageDetector.detect('Bonjour, je voudrais de l aide')).toBe('fr');
  });

  it('detects Arabic Script (MSA)', () => {
    expect(LanguageDetector.detect('ما هي ساعات العمل لديكم؟')).toBe('ar');
    expect(LanguageDetector.detect('كم سعر باقة البداية؟')).toBe('ar');
  });

  it('detects Moroccan Darija (Latin / Arabizi)', () => {
    expect(LanguageDetector.detect('bonjour bghit n3rf dakchi lkatbi3o')).toBe('darija');
    expect(LanguageDetector.detect('chhal taman dyal starter plan?')).toBe('darija');
    expect(LanguageDetector.detect('wach kayn chi remise 3afak?')).toBe('darija');
  });
});

describe('FaqMatcher', () => {
  const sampleFaq: FaqEntry[] = [
    {
      id: 'faq_hours',
      questions: {
        en: 'What are your business hours?',
        fr: "Quels sont vos horaires d'ouverture?",
        ar: 'ما هي ساعات العمل لديكم؟',
        darija: 'fo9ach katkhedmo?'
      },
      answers: {
        en: 'Our support team is available Monday to Friday from 09:00 to 18:00.',
        fr: "Notre équipe d'assistance est disponible du lundi au vendredi de 09h00 à 18h00.",
        ar: 'فريق الدعم لدينا متاح من الإثنين إلى الجمعة من الساعة 09:00 حتى 18:00.',
        darija: "L'équipe support dyalna khdama mn letnin l jem3a, mn 09:00 l 18:00."
      },
      keywords: {
        en: ['business hours', 'support hours', 'opening hours'],
        fr: ['horaires', 'ouverture', 'heures'],
        ar: ['ساعات العمل', 'أوقات العمل'],
        darija: ['fo9ach', 'khedmin', 'sa3at']
      }
    }
  ];

  it('matches exact question in English without LLM', () => {
    const match = FaqMatcher.match('What are your business hours?', sampleFaq);
    expect(match).not.toBeNull();
    expect(match?.answer).toBe('Our support team is available Monday to Friday from 09:00 to 18:00.');
    expect(match?.matchedLang).toBe('en');
  });

  it('matches French question', () => {
    const match = FaqMatcher.match("Quels sont vos horaires d'ouverture?", sampleFaq);
    expect(match).not.toBeNull();
    expect(match?.answer).toContain("du lundi au vendredi");
    expect(match?.matchedLang).toBe('fr');
  });

  it('matches Arabic question', () => {
    const match = FaqMatcher.match('ما هي ساعات العمل لديكم؟', sampleFaq);
    expect(match).not.toBeNull();
    expect(match?.answer).toContain('من الإثنين إلى الجمعة');
    expect(match?.matchedLang).toBe('ar');
  });

  it('matches Darija Latin question', () => {
    const match = FaqMatcher.match('fo9ach katkhedmo?', sampleFaq);
    expect(match).not.toBeNull();
    expect(match?.answer).toContain('khdama mn letnin l jem3a');
    expect(match?.matchedLang).toBe('darija');
  });

  it('returns null on unrelated question to fall through', () => {
    const match = FaqMatcher.match('Can you tell me about deep learning algorithms?', sampleFaq);
    expect(match).toBeNull();
  });
});
