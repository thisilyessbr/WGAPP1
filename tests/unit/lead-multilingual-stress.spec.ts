import { describe, expect, it, vi } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { CRMService } from '../../src/domain/crm/CRMService';

const productContext = { selectedProductId: 'shoe-42', selectedSku: 'SHOE-42' };
const cases: Array<[string, string, boolean]> = [
  ['Darija Latin', 'bghit nchri had sbat', true],
  ['Darija Latin', 'bghit ncommandi had sbat', true],
  ['Darija Latin', 'baghi nchri had sbat', true],
  ['Darija Latin', 'baghya nchri had sbat', true],
  ['Darija Latin', 'nchri had sbat', true],
  ['Darija Latin', 'bghit nkhod had sbat', true],
  ['Darija Latin', 'wach n9der ncommandi had sbat?', true],
  ['Darija Latin', 'ana bghit nechri had sbat', true],
  ['Darija Latin', 'bghit nshri had sbat', true],
  ['Darija Latin', 'bghiiit nchri had sbat', true],
  ['Darija Latin', 'ma bghitch nchri had sbat', false],
  ['Darija Latin', 'machi bghit ncommandi', false],
  ['Darija Latin', 'chhal taman dyal had sbat?', false],
  ['Darija Latin', 'wach kayn khlas 3nd livraison?', false],
  ['Darija Latin', 'fin wslat commande dyali?', false],
  ['Darija Latin', 'bghit nrje3 had sbat', false],
  ['Darija Latin', 'achno tansahni nchri?', false],
  ['Darija Latin', 'salam wach kayn livraison?', false],
  ['Darija Latin', 'ma bghitch nchri l9dim walakin bghit nchri jdid', true],
  ['Darija Latin', 'bghit nchri had sbat. la', false],
  ['Darija Arabic', 'بغيت نشري هاد الصباط', true],
  ['Darija Arabic', 'بغيت نكوموندي هاد الصباط', true],
  ['Darija Arabic', 'باغي نشري هاد الصباط', true],
  ['Darija Arabic', 'باغية نشري هاد الصباط', true],
  ['Darija Arabic', 'بغيت نطلب هاد الصباط', true],
  ['Darija Arabic', 'واش نقدر نشري هاد الصباط؟', true],
  ['Darija Arabic', 'بغيت ناخد هاد الصباط', true],
  ['Darija Arabic', 'بغيت نشريه', true],
  ['Darija Arabic', 'ما بغيتش نشري هاد الصباط', false],
  ['Darija Arabic', 'ماشي باغي نشري', false],
  ['Darija Arabic', 'شحال ثمن هاد الصباط؟', false],
  ['Darija Arabic', 'واش كاين الدفع عند الاستلام؟', false],
  ['Darija Arabic', 'فين وصلات الكوموند ديالي؟', false],
  ['Darija Arabic', 'شنو تنصحني نشري؟', false],
  ['Darija Arabic', 'بغيت نشري هاد الصباط. لا', false],
  ['Arabic', 'أريد شراء هذا المنتج', true],
  ['Arabic', 'أريد أن أطلب هذا المنتج', true],
  ['Arabic', 'سأشتري هذا', true],
  ['Arabic', 'سوف أشتري هذا', true],
  ['Arabic', 'اريد شراء هذا', true],
  ['Arabic', 'أريد شراءه', true],
  ['Arabic', 'أريد أن أشتريه', true],
  ['Arabic', 'أريد طلب هذا', true],
  ['Arabic', 'لا أريد شراء هذا', false],
  ['Arabic', 'لن أشتري هذا', false],
  ['Arabic', 'كم سعر هذا المنتج؟', false],
  ['Arabic', 'هل الدفع عند الاستلام متاح؟', false],
  ['Arabic', 'أين طلبي السابق؟', false],
  ['Arabic', 'ما أفضل منتج تنصحني به؟', false],
  ['Arabic', 'لا أريد شراء الأحمر لكن أريد شراء الأزرق', true],
  ['French', 'je veux acheter ces chaussures', true],
  ['French', 'je veux commander ces chaussures', true],
  ['French', 'je voudrais acheter ces chaussures', true],
  ['French', 'je voudrais commander ces chaussures', true],
  ['French', 'je passe commande pour ces chaussures', true],
  ['French', 'comment acheter ces chaussures ?', true],
  ['French', 'je vais acheter ces chaussures', true],
  ['French', 'je veux prendre ces chaussures', true],
  ['French', 'je ne veux pas acheter ces chaussures', false],
  ['French', 'je ne veux pas commander', false],
  ['French', 'combien coûtent ces chaussures ?', false],
  ['French', 'est-ce que le paiement à la livraison est disponible ?', false],
  ['French', 'où est ma commande ?', false],
  ['French', 'je veux retourner ces chaussures', false],
  ['French', 'quelles chaussures me conseillez-vous ?', false],
  ['French', 'je ne veux pas acheter le rouge, mais je veux acheter le bleu', true],
  ['French', 'je veux acheter ces chaussures. Non', false]
];

describe('lead detection multilingual stress matrix', () => {
  it.each([
    ['bghit nchri had sbat',true],
    ['baghi nchri had sbat',true],
    ['ma bghitch nchri had sbat',false],
    ['بغيت نشري هاد الصباط',true],
    ['باغية نشري هاد الصباط',true],
    ['ما بغيتش نشري هاد الصباط',false],
    ['أريد شراء هذا',true],
    ['أود شراء هذا',true],
    ['سأشتري هذا',true],
    ['لا أريد شراء هذا',false],
    ['je veux acheter ces chaussures',true],
    ['je voudrais acheter ces chaussures',true],
    ['je vais commander ces chaussures',true],
    ['je ne veux pas acheter ces chaussures',false],
    ['combien ça coûte ?',false]
  ])('normal chatbot lead signal: %s → %s', async (message, expected) => {
    const upsert = vi.fn(async () => ({ id: 'lead-1' }));
    const crm = new CRMService({ lead: { upsert } } as any);
    const lead = await crm.processTurnSignal({tenantId:'tenant',accountId:'account',customerId:'customer',userMessage:message});
    expect(Boolean(lead)).toBe(expected);
  });
  it.each(cases)('%s: %s → lead=%s', async (language, message, expected) => {
    const upsert = vi.fn(async () => ({ id: 'lead-1' }));
    const crm = new CRMService({ lead: { upsert } } as any);
    const parsed = EcommerceIntentParser.parse(message, productContext, language === 'French' ? 'fr' : 'ar');
    const decision = TurnDecisionResolver.resolve({
      text: message,
      language: language === 'French' ? 'fr' : 'ar',
      productContext,
      ecommerceParams: parsed,
      isEcommerceEnabled: true
    });
    const lead = await crm.processTurnSignal({
      tenantId: 'tenant', accountId: 'account', customerId: 'customer',
      turnDecision: decision, userMessage: message
    });
    expect(Boolean(lead), `${language}: ${message}; parser=${parsed.intent}; decision=${decision.intent}`).toBe(expected);
    expect(upsert).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
});
