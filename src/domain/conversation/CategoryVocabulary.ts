/**
 * CategoryVocabulary.ts
 *
 * Generic category vocabulary provider.
 * Normalizes, matches, and maps user category mentions to canonical categories
 * without tenant-specific or hardcoded product rules.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

import { TextNormalizer } from './TextNormalizer';

export interface CategoryDefinition {
  canonical: string;
  labels: Record<string, string>; // e.g. { en: 'Hoodies', fr: 'Sweats & Hoodies', ar: 'هوديات' }
  aliases: string[];
}

export class CategoryVocabulary {
  private static defaultCategories: CategoryDefinition[] = [
    {
      canonical: 'T-Shirts',
      labels: { en: 'T-Shirts', fr: 'T-Shirts', ar: 'تيشورتات' },
      aliases: [
        't-shirt', 't-shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'shirt', 'shirts', 't-shirten',
        'تيشورت', 'تيشورتات', 'تيشيرت', 'تيشيرتات', 'قميص', 'قمصان', 't-shirtat', 'tshirtat'
      ]
    },
    {
      canonical: 'Hoodies',
      labels: { en: 'Hoodies', fr: 'Sweats & Hoodies', ar: 'هوديات' },
      aliases: [
        'hoodie', 'hoodies', 'sweat', 'sweats', 'sweatshirt', 'sweatshirts', 'pull', 'capuchon',
        'هودي', 'هوديات', 'سويت', 'سويتشرت', 'كابوشون'
      ]
    },
    {
      canonical: 'Jackets',
      labels: { en: 'Jackets', fr: 'Vestes & Blousons', ar: 'جاكيتات' },
      aliases: [
        'jacket', 'jackets', 'veste', 'vestes', 'blouson', 'blousons', 'manteau', 'manteaux',
        'جاكيط', 'جاكيطات', 'جاكيت', 'جاكيتات', 'سترة', 'سترات'
      ]
    },
    {
      canonical: 'Shoes',
      labels: { en: 'Shoes', fr: 'Chaussures', ar: 'أحذية' },
      aliases: [
        'shoes', 'shoe', 'sneakers', 'sneaker', 'chaussures', 'chaussure', 'baskets', 'basket',
        'حذاء', 'أحذية', 'احذية', 'سباط', 'صباط', 'سبابط', 'صبابط', 'سبرديلة', 'صبرديلة', 'سبراديل', 'صنادل', 'صندالة'
      ]
    },
    {
      canonical: 'Pants',
      labels: { en: 'Pants & Jeans', fr: 'Pantalons & Jeans', ar: 'سراويل وجينز' },
      aliases: [
        'pants', 'pant', 'jeans', 'jean', 'trousers', 'pantalon', 'pantalons', 'jogging',
        'سروال', 'سراول', 'بنطلون', 'بناطيل', 'جينز'
      ]
    },
    {
      canonical: 'Accessories',
      labels: { en: 'Accessories', fr: 'Accessoires', ar: 'إكسسوارات' },
      aliases: [
        'accessories', 'accessory', 'accessoires', 'accessoire',
        'إكسسوار', 'اكسسوار', 'إكسسوارات', 'اكسسوارات'
      ]
    }
  ];

  /**
   * Matches a token or text against category definitions and returns the canonical category name.
   */
  public static matchCategory(text: string, customCategories?: CategoryDefinition[]): string | undefined {
    if (!text || !text.trim()) return undefined;

    const categories = customCategories && customCategories.length > 0 ? customCategories : this.defaultCategories;
    const cleanTokens = TextNormalizer.tokenizeAndNormalize(text);
    const normalizedText = TextNormalizer.normalizeForMatching(text);

    for (const cat of categories) {
      for (const alias of cat.aliases) {
        const normAlias = TextNormalizer.normalizeForMatching(alias);
        if (!normAlias) continue;

        // Check exact match in tokens (with proclitic stripping)
        for (const token of cleanTokens) {
          if (token === normAlias) return cat.canonical;
          const stripped = TextNormalizer.stripProclitic(token);
          if (stripped === normAlias) return cat.canonical;
        }

        // Check boundary phrase match
        const regex = new RegExp(`(?:^|\\s)(?:l-|d-|f-|ال|فال|بال|ف|ب)?${normAlias}(?:$|\\s)`, 'u');
        if (regex.test(normalizedText)) {
          return cat.canonical;
        }
      }
    }

    return undefined;
  }

  /**
   * Checks if a token is a category alias or reference.
   */
  public static isCategoryToken(token: string, customCategories?: CategoryDefinition[]): boolean {
    return Boolean(this.matchCategory(token, customCategories));
  }

  /**
   * Returns all canonical categories as a record of aliases.
   */
  public static getCanonicalMap(): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const cat of this.defaultCategories) {
      map[cat.canonical] = cat.aliases;
    }
    return map;
  }
}
