/** Fast, LLM-free probe: does each corpus product phrase resolve to the right catalog product? */
import 'dotenv/config';
import { prisma } from '../../src/tests/testDb';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';
import { buildCorpus } from './moroccanCommerceCorpus';

const TENANT = 'eval-moroccan-commerce', ACCOUNT = 'eval-moroccan-commerce-store';

async function main() {
  const service = new EcommerceService(new ProductRepository(prisma));
  const categories = await service.getDistinctCategories(TENANT, ACCOUNT);
  const cases = buildCorpus().filter(c => 'product' in c.expect && ['price', 'available', 'photo', 'variant'].includes(c.intent));
  const seen = new Set<string>();
  let ok = 0, total = 0;
  const failures: string[] = [];
  for (const c of cases) {
    const text = c.turns.at(-1)!;
    if (seen.has(text)) continue; seen.add(text); total++;
    const detected: any = { language: LanguageDetector.detect(text) };
    const catalogProductId = (await service.matchProductFromText(TENANT, ACCOUNT, text))?.id || null;
    const d: any = TurnDecisionResolver.resolve({ text, language: detected.language, isEcommerceEnabled: true, catalogProductId } as any);
    const name = d.productName || d.searchKeywords;
    let fact: any = d.catalogProductId ? await service.getProductFact(TENANT, ACCOUNT, { id: d.catalogProductId }, detected.language) : name ? await service.getProductFact(TENANT, ACCOUNT, { name }, detected.language) : null;
    if (!fact && d.category) {
      const found = await service.searchProducts(TENANT, ACCOUNT, undefined, detected.language, { category: d.category, limit: 3 });
      if (found.length === 1) fact = found[0];
    }
    const expected = (c.expect as any).product as string;
    const got = fact?.product?.sku || null;
    const sku = { caftan: 'AM-CAF', djellaba: 'AM-DJL', jean: 'AM-JEA', sneakers: 'AM-SNK', bag: 'AM-BAG', abaya: 'AM-ABY', tshirt: 'AM-TSH', babouche: 'AM-BAB', watch: 'AM-WAT', hoodie: 'AM-HOD' }[expected];
    if (got === sku && d.domain === 'ECOMMERCE') ok++;
    else failures.push(`${c.lang} ${c.intent} | ${text} | domain=${d.domain} intent=${d.intent} name=${d.productName ?? '-'} kw=${d.searchKeywords ?? '-'} cat=${d.category ?? '-'} image=${d.wantsImage ?? d.mediaRequested ?? '-'} => ${got ?? 'NONE'} (want ${sku})`);
  }
  console.log(failures.join('\n'));
  console.log(`\nresolved ${ok}/${total}`);
}
void main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
