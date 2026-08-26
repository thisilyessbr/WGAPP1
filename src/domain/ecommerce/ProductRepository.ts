import { PrismaClient, Product, ProductVariant } from '@prisma/client';

export interface ProductWithVariants extends Product {
  variants: ProductVariant[];
}

export interface ProductSearchParams {
  tenantId: string;
  accountId: string;
  query?: string;
  category?: string;
  maxPrice?: number;
  color?: string;
  size?: string;
  activeOnly?: boolean;
  limit?: number;
}

export class ProductRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(tenantId: string, accountId: string, activeOnly = true): Promise<ProductWithVariants[]> {
    if (!tenantId || !accountId) return [];
    return this.search({ tenantId, accountId, activeOnly });
  }

  async findById(tenantId: string, accountId: string, id: string, activeOnly = true): Promise<ProductWithVariants | null> {
    if (!tenantId || !accountId || !id) return null;
    return this.prisma.product.findFirst({
      where: {
        id,
        tenantId,
        accountId,
        ...(activeOnly ? { active: true } : {})
      },
      include: {
        variants: {
          where: activeOnly ? { active: true } : {},
          orderBy: { sku: 'asc' }
        }
      }
    });
  }

  async findByName(tenantId: string, accountId: string, name: string): Promise<ProductWithVariants | null> {
    if (!tenantId || !accountId || !name) return null;
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();

    // 1. Direct Prisma search on name / description
    const direct = await this.prisma.product.findFirst({
      where: {
        tenantId,
        accountId,
        active: true,
        OR: [
          { name: { equals: trimmed, mode: 'insensitive' } },
          { name: { contains: trimmed, mode: 'insensitive' } },
          { description: { contains: trimmed, mode: 'insensitive' } }
        ]
      },
      include: {
        variants: {
          where: { active: true },
          orderBy: { sku: 'asc' }
        }
      }
    });

    if (direct) return direct;

    // 2. Localized JSON search across products in this account
    const allProducts = await this.prisma.product.findMany({
      where: { tenantId, accountId, active: true },
      include: {
        variants: {
          where: { active: true },
          orderBy: { sku: 'asc' }
        }
      },
      take: 50
    });

    for (const prod of allProducts) {
      if (prod.name.toLowerCase().includes(lower) || lower.includes(prod.name.toLowerCase())) return prod;
      const locName = prod.nameLocalized as Record<string, string> | null;
      if (locName && typeof locName === 'object') {
        for (const val of Object.values(locName)) {
          if (typeof val === 'string' && (val.toLowerCase().includes(lower) || lower.includes(val.toLowerCase()))) {
            return prod;
          }
        }
      }
    }

    return null;
  }

  async findBySku(tenantId: string, accountId: string, sku: string): Promise<ProductWithVariants | null> {
    if (!tenantId || !accountId || !sku) return null;
    const normalizedSku = sku.trim().toUpperCase();

    // 1. Check parent product SKU
    const product = await this.prisma.product.findFirst({
      where: {
        tenantId,
        accountId,
        sku: { equals: normalizedSku, mode: 'insensitive' },
        active: true
      },
      include: {
        variants: {
          where: { active: true },
          orderBy: { sku: 'asc' }
        }
      }
    });

    if (product) return product;

    // 2. Check variant SKU
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        sku: { equals: normalizedSku, mode: 'insensitive' },
        active: true,
        product: {
          tenantId,
          accountId,
          active: true
        }
      },
      include: {
        product: {
          include: {
            variants: {
              where: { active: true },
              orderBy: { sku: 'asc' }
            }
          }
        }
      }
    });

    return variant?.product || null;
  }

  private normalizeSearchTerm(t: string): string {
    return t
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[إأآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .toLowerCase();
  }

  private static readonly NOISE_TOKENS = new Set([
    'on', 'in', 'at', 'to', 'of', 'for', 'by', 'an', 'as', 'is', 'it', 'or', 'and', 'the',
    'et', 'en', 'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'par', 'sur', 'pour',
    'جديدة', 'جديد', 'الجديدة', 'الجديد', 'الأسبوع', 'الاسبوع', 'الجاي', 'الماضي', 'القادم', 'شي', 'واحد', 'كاين', 'كاينين', 'عندكم', 'واش', 'ديال', 'ديالي',
    'next', 'week', 'new', 'upcoming', 'collection', 'prochaine', 'semaine', 'nouvelle', 'nouveau', 'avez', 'vous', 'have'
  ]);

  private getTermVariations(rawQuery: string): string[] {
    const cleanRaw = rawQuery.replace(/[?؟,،.!;:()[\]{}'"]/g, ' ');
    const tokens = cleanRaw.trim().split(/\s+/).filter(t => (t.length > 2 || /^\d+$/.test(t)) && !ProductRepository.NOISE_TOKENS.has(t.toLowerCase()));
    const variations = new Set<string>();

    for (const token of tokens) {
      const lower = token.toLowerCase();
      const norm = this.normalizeSearchTerm(token);
      variations.add(lower);
      variations.add(norm);

      // English / French plurals
      if (lower.endsWith('ies') && lower.length > 4) variations.add(lower.slice(0, -3) + 'y');
      if (lower.endsWith('es') && lower.length > 3) variations.add(lower.slice(0, -2));
      if (lower.endsWith('s') && lower.length > 2) variations.add(lower.slice(0, -1));

      // Arabic definite article and plurals
      let stripped = norm;
      if (stripped.startsWith('ال') && stripped.length > 3) {
        stripped = stripped.slice(2);
        variations.add(stripped);
      }
      if (stripped.endsWith('ات') && stripped.length > 3) {
        variations.add(stripped.slice(0, -2));
        variations.add(stripped.slice(0, -2) + 'ي');
      }
    }

    // Apply phonetic and dialectal spelling variants across all collected terms
    const dialectVariants = new Set<string>();
    for (const v of variations) {
      if (v.includes('تيشورت')) dialectVariants.add(v.replace(/تيشورت/g, 'تيشيرت'));
      if (v.includes('تيشيرت')) dialectVariants.add(v.replace(/تيشيرت/g, 'تيشورت'));
      if (v.includes('جاكيط')) dialectVariants.add(v.replace(/جاكيط/g, 'جاكيت'));
      if (v.includes('جاكيت')) dialectVariants.add(v.replace(/جاكيت/g, 'جاكيط'));
      if (v.includes('سباط')) dialectVariants.add(v.replace(/سباط/g, 'حذاء'));
      if (v.includes('صباط')) dialectVariants.add(v.replace(/صباط/g, 'حذاء'));
      if (v.includes('حذاء')) dialectVariants.add(v.replace(/حذاء/g, 'سباط'));
    }
    for (const dv of dialectVariants) {
      variations.add(dv);
    }

    return Array.from(variations).filter(v => v.length > 1);
  }

  async search(params: ProductSearchParams): Promise<ProductWithVariants[]> {
    const { tenantId, accountId, query, category, maxPrice, color, size, activeOnly = true, limit = 10 } = params;
    if (!tenantId || !accountId) return [];

    const whereClause: any = {
      tenantId,
      accountId,
      ...(activeOnly ? { active: true } : {})
    };

    if (category) {
      const catSingular = category.endsWith('s') && category.length > 3 ? category.slice(0, -1) : category;
      const catPlural = category.endsWith('s') ? category : `${category}s`;
      whereClause.category = {
        in: [category, catSingular, catPlural]
      };
    }

    if (typeof maxPrice === 'number' && maxPrice > 0) {
      whereClause.price = { lte: maxPrice };
    }

    const conditions: any[] = [];

    if (query && query.trim()) {
      const q = query.trim();
      const qSingular = q.endsWith('s') && q.length > 3 ? q.slice(0, -1) : null;
      const queries = qSingular ? [q, qSingular] : [q];

      for (const term of queries) {
        conditions.push(
          { name: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          {
            variants: {
              some: {
                OR: [
                  { name: { contains: term, mode: 'insensitive' } },
                  { sku: { contains: term, mode: 'insensitive' } },
                  { color: { contains: term, mode: 'insensitive' } },
                  { size: { contains: term, mode: 'insensitive' } }
                ]
              }
            }
          }
        );
      }
    }

    if (color || size) {
      whereClause.variants = {
        some: {
          ...(activeOnly ? { active: true } : {}),
          ...(color ? { color: { contains: color, mode: 'insensitive' } } : {}),
          ...(size ? { size: { equals: size, mode: 'insensitive' } } : {})
        }
      };
    }

    if (conditions.length > 0) {
      whereClause.OR = conditions;
    }

    const directResults = await this.prisma.product.findMany({
      where: whereClause,
      include: {
        variants: {
          where: activeOnly ? { active: true } : {},
          orderBy: { sku: 'asc' }
        }
      },
      take: limit,
      orderBy: { createdAt: 'desc' }
    });

    if (!query || directResults.length >= limit) {
      return directResults;
    }

    // Localized & normalized matching across nameLocalized / descriptionLocalized
    const matchedIds = new Set(directResults.map(p => p.id));
    const searchTerms = this.getTermVariations(query);

    if (searchTerms.length === 0) {
      return directResults;
    }

    const allAccountProducts = await this.prisma.product.findMany({
      where: {
        tenantId,
        accountId,
        ...(activeOnly ? { active: true } : {}),
        ...(typeof maxPrice === 'number' && maxPrice > 0 ? { price: { lte: maxPrice } } : {}),
        ...(category ? {
          category: {
            in: [
              category,
              category.endsWith('s') && category.length > 3 ? category.slice(0, -1) : category,
              category.endsWith('s') ? category : `${category}s`
            ],
            mode: 'insensitive'
          }
        } : {}),
        ...(color || size ? {
          variants: {
            some: {
              ...(activeOnly ? { active: true } : {}),
              ...(color ? { color: { contains: color, mode: 'insensitive' } } : {}),
              ...(size ? { size: { equals: size, mode: 'insensitive' } } : {})
            }
          }
        } : {})
      },
      include: {
        variants: {
          where: activeOnly ? { active: true } : {},
          orderBy: { sku: 'asc' }
        }
      },
      take: 50
    });

    const localizedMatches: ProductWithVariants[] = [];
    for (const prod of allAccountProducts) {
      if (matchedIds.has(prod.id)) continue;

      const searchableTexts: string[] = [
        prod.name,
        prod.description,
        prod.category || '',
        prod.sku
      ].map(s => this.normalizeSearchTerm(s));

      const locName = prod.nameLocalized as Record<string, string> | null;
      if (locName && typeof locName === 'object') {
        for (const val of Object.values(locName)) {
          if (typeof val === 'string') searchableTexts.push(this.normalizeSearchTerm(val));
        }
      }

      const locDesc = prod.descriptionLocalized as Record<string, string> | null;
      if (locDesc && typeof locDesc === 'object') {
        for (const val of Object.values(locDesc)) {
          if (typeof val === 'string') searchableTexts.push(this.normalizeSearchTerm(val));
        }
      }

      const combined = searchableTexts.join(' ');
      const isMatch = searchTerms.some(term => combined.includes(term));
      if (isMatch) {
        localizedMatches.push(prod);
        matchedIds.add(prod.id);
      }
    }

    return [...directResults, ...localizedMatches].slice(0, limit);
  }

  async getDistinctCategories(tenantId: string, accountId: string, activeOnly = true): Promise<string[]> {
    if (!tenantId || !accountId) return [];
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        accountId,
        ...(activeOnly ? { active: true } : {}),
        category: { not: null }
      },
      select: { category: true },
      distinct: ['category']
    });
    return products.map(p => p.category!).filter(Boolean);
  }

  async findAvailableVariants(tenantId: string, accountId: string, productId: string): Promise<ProductVariant[]> {
    if (!tenantId || !accountId || !productId) return [];
    return this.prisma.productVariant.findMany({
      where: {
        productId,
        active: true,
        product: {
          tenantId,
          accountId,
          active: true
        }
      },
      orderBy: { sku: 'asc' }
    });
  }

  async createProduct(
    tenantId: string,
    accountId: string,
    data: {
      name: string;
      sku: string;
      description?: string;
      price: number;
      currency?: string;
      stock?: number;
      category?: string;
      nameLocalized?: Record<string, string>;
      descriptionLocalized?: Record<string, string>;
      metadata?: Record<string, unknown> | null;
      active?: boolean;
    }
  ): Promise<ProductWithVariants> {
    return this.prisma.product.create({
      data: {
        tenantId,
        accountId,
        name: data.name.trim(),
        sku: data.sku.trim().toUpperCase(),
        description: (data.description || '').trim(),
        price: data.price,
        currency: data.currency || 'USD',
        stock: data.stock !== undefined ? data.stock : 0,
        category: data.category ? data.category.trim() : null,
        nameLocalized: data.nameLocalized || null,
        descriptionLocalized: data.descriptionLocalized || null,
        metadata: data.metadata !== undefined ? (data.metadata as any) : null,
        active: data.active !== undefined ? data.active : true
      },
      include: {
        variants: {
          orderBy: { sku: 'asc' }
        }
      }
    });
  }

  async updateProduct(
    tenantId: string,
    accountId: string,
    id: string,
    data: {
      name?: string;
      sku?: string;
      description?: string;
      price?: number;
      currency?: string;
      stock?: number;
      category?: string;
      nameLocalized?: Record<string, string>;
      descriptionLocalized?: Record<string, string>;
      metadata?: Record<string, unknown> | null;
      active?: boolean;
    }
  ): Promise<ProductWithVariants | null> {
    const existing = await this.findById(tenantId, accountId, id, false);
    if (!existing) return null;

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.sku !== undefined ? { sku: data.sku.trim().toUpperCase() } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.category !== undefined ? { category: data.category ? data.category.trim() : null } : {}),
        ...(data.nameLocalized !== undefined ? { nameLocalized: data.nameLocalized } : {}),
        ...(data.descriptionLocalized !== undefined ? { descriptionLocalized: data.descriptionLocalized } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata as any } : {}),
        ...(data.active !== undefined ? { active: data.active } : {})
      },
      include: {
        variants: {
          orderBy: { sku: 'asc' }
        }
      }
    });
  }

  async deleteProduct(tenantId: string, accountId: string, id: string): Promise<boolean> {
    const existing = await this.findById(tenantId, accountId, id, false);
    if (!existing) return false;

    await this.prisma.product.delete({
      where: { id }
    });
    return true;
  }

  async createVariant(
    tenantId: string,
    accountId: string,
    productId: string,
    data: {
      sku: string;
      name?: string;
      size?: string;
      color?: string;
      priceOverride?: number | null;
      stock?: number;
      metadata?: Record<string, unknown> | null;
      active?: boolean;
    }
  ): Promise<ProductVariant | null> {
    const product = await this.findById(tenantId, accountId, productId, false);
    if (!product) return null;

    return this.prisma.productVariant.create({
      data: {
        productId,
        sku: data.sku.trim().toUpperCase(),
        name: data.name ? data.name.trim() : null,
        size: data.size ? data.size.trim() : null,
        color: data.color ? data.color.trim() : null,
        priceOverride: data.priceOverride !== undefined ? data.priceOverride : null,
        stock: data.stock !== undefined ? data.stock : 0,
        metadata: data.metadata !== undefined ? (data.metadata as any) : null,
        active: data.active !== undefined ? data.active : true
      }
    });
  }

  async updateVariant(
    tenantId: string,
    accountId: string,
    productId: string,
    variantId: string,
    data: {
      sku?: string;
      name?: string;
      size?: string;
      color?: string;
      priceOverride?: number | null;
      stock?: number;
      metadata?: Record<string, unknown> | null;
      active?: boolean;
    }
  ): Promise<ProductVariant | null> {
    const product = await this.findById(tenantId, accountId, productId, false);
    if (!product) return null;

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId }
    });
    if (!variant) return null;

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(data.sku !== undefined ? { sku: data.sku.trim().toUpperCase() } : {}),
        ...(data.name !== undefined ? { name: data.name ? data.name.trim() : null } : {}),
        ...(data.size !== undefined ? { size: data.size ? data.size.trim() : null } : {}),
        ...(data.color !== undefined ? { color: data.color ? data.color.trim() : null } : {}),
        ...(data.priceOverride !== undefined ? { priceOverride: data.priceOverride } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata as any } : {}),
        ...(data.active !== undefined ? { active: data.active } : {})
      }
    });
  }

  async deleteVariant(tenantId: string, accountId: string, productId: string, variantId: string): Promise<boolean> {
    const product = await this.findById(tenantId, accountId, productId, false);
    if (!product) return false;

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId }
    });
    if (!variant) return false;

    await this.prisma.productVariant.delete({
      where: { id: variantId }
    });
    return true;
  }
}
