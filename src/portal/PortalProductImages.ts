import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import type { PortalStore } from './PortalStore';
import { BusinessData, PortalError } from './types';

export const businessImageIds = (data: BusinessData): string[] => [...new Set(data.products.flatMap(p => [
  ...(p.imageIds || []), ...p.variants.map(v => v.imageId).filter((id): id is string => Boolean(id))
]))];

// References, never external URLs, cross the draft boundary. Bytes survive web/worker restarts.
export async function assertBusinessImages(store: PortalStore, accountId: string, data: BusinessData) {
  const ids = businessImageIds(data);
  if (!ids.length) return;
  const rows = await store.db.$queryRaw<{ id: string }[]>`SELECT id FROM "PortalProductImage"
    WHERE "accountId"=${accountId} AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
  if (rows.length !== ids.length) throw new PortalError(400, 'IMAGE_UNAVAILABLE', 'A product photo is missing or belongs to another account.');
}

export function productImageUrl(id: string) {
  const base = new URL(process.env.PORTAL_PUBLIC_URL || 'http://localhost:3000');
  return `${base.origin}/api/product-images/${id}`;
}

export class PortalProductImages {
  constructor(private store: PortalStore) {}
  async list(accountId: string) {
    return this.store.db.$queryRaw<any[]>`SELECT id,filename,size,width,height,published FROM "PortalProductImage" WHERE "accountId"=${accountId} ORDER BY "createdAt" DESC LIMIT 1000`;
  }
  async upload(actorId: string, accountId: string, filename: string, input: Buffer, administrative = false) {
    if (!input.length || input.length > 5 * 1048576) throw new PortalError(400, 'INVALID_IMAGE', 'Choose a JPEG, PNG or WebP photo up to 5 MB.');
    // Reject SVG/animations/decompression bombs and strip GPS/EXIF by fully re-encoding.
    let bytes: Buffer, width: number, height: number;
    try {
      const image = sharp(input, { limitInputPixels: 25_000_000, failOn: 'warning' });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages || 1) !== 1) throw Error();
      const result = await image.rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
      bytes = result.data; width = result.info.width; height = result.info.height;
    } catch { throw new PortalError(400, 'INVALID_IMAGE', 'Choose a valid JPEG, PNG or WebP photo up to 5 MB and 25 megapixels.'); }
    const hash = createHash('sha256').update(bytes).digest('hex');
    const name = filename.replace(/.*[\\/]/, '').replace(/[\u0000-\u001f]/g, '').slice(0, 160) || 'product.jpg';
    return this.store.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (!administrative && p.editingFrozen) throw new PortalError(403, 'CLIENT_EDITING_FROZEN', 'Chatbot information is locked by the administrator.');
      const plan = p.planSnapshot || (p.requestedPlanId ? await s.plan(p.requestedPlanId) : null);
      if (!plan?.modules.includes('commerce') || p.adminConfig?.capabilities?.ecommerceEnabled === false || p.status === 'SUSPENDED') throw new PortalError(403, 'COMMERCE_NOT_AVAILABLE');
      if (!administrative && p.lockedFields.includes('products')) throw new PortalError(403, 'FIELD_LOCKED');
      const found = (await s.db.$queryRaw<any[]>`SELECT id FROM "PortalProductImage" WHERE "accountId"=${accountId} AND hash=${hash}`)[0];
      if (found) return { id: found.id, reused: true };
      const usage = (await s.db.$queryRaw<any[]>`SELECT COALESCE(SUM(size),0)::bigint AS bytes FROM (
        SELECT size FROM "PortalDocument" WHERE "accountId"=${accountId} UNION ALL SELECT size FROM "PortalProductImage" WHERE "accountId"=${accountId}
      ) files`)[0];
      if (Number(usage.bytes) + bytes.length > plan.limits.storageMb * 1048576) throw new PortalError(402, 'STORAGE_ALLOWANCE_REACHED', 'Storage is full. Remove unused photos or contact your administrator.');
      const count = (await s.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "PortalProductImage" WHERE "accountId"=${accountId}`)[0].n;
      if (count >= 1000) throw new PortalError(402, 'PHOTO_ALLOWANCE_REACHED');
      const id = randomUUID();
      await s.db.$executeRaw`INSERT INTO "PortalProductImage"(id,"accountId",filename,hash,bytes,size,width,height)
        VALUES (${id},${accountId},${name},${hash},${bytes},${bytes.length},${width},${height})`;
      await s.audit(actorId, accountId, 'PRODUCT_IMAGE_UPLOADED', { imageId: id, size: bytes.length });
      return { id, reused: false };
    });
  }
  async read(id: string, accountId?: string, publishedOnly = false) {
    const row = (await this.store.db.$queryRaw<any[]>`SELECT i.bytes,i.width,i.height FROM "PortalProductImage" i
      JOIN "PortalProfile" p ON p."accountId"=i."accountId"
      WHERE i.id=${id} AND (${accountId || null}::text IS NULL OR i."accountId"=${accountId || null})
      AND (${publishedOnly}=false OR (i.published=true AND p.status <> 'SUSPENDED'
        AND p."planSnapshot"->'modules' @> '["commerce"]'::jsonb
        AND COALESCE(p."adminConfig"->'capabilities'->>'ecommerceEnabled','true') <> 'false'))`)[0];
    if (!row) throw new PortalError(404, 'IMAGE_NOT_FOUND');
    return Buffer.from(row.bytes);
  }
  async remove(actorId: string, accountId: string, id: string, administrative = false) {
    await this.store.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (!administrative && p.editingFrozen) throw new PortalError(403, 'CLIENT_EDITING_FROZEN', 'Chatbot information is locked by the administrator.');
      if (!administrative && p.lockedFields.includes('products')) throw new PortalError(403, 'FIELD_LOCKED');
      const history = await s.db.$queryRaw<any[]>`SELECT data FROM "PortalPublication" WHERE "accountId"=${accountId}`;
      if ([p.draft, p.published, ...history.map(h => h.data)].filter(Boolean).some(d => businessImageIds(d).includes(id))) {
        throw new PortalError(409, 'IMAGE_IN_USE', 'This photo is used in saved business data or publication history.');
      }
      const deleted = await s.db.$executeRaw`DELETE FROM "PortalProductImage" WHERE id=${id} AND "accountId"=${accountId}`;
      if (!deleted) throw new PortalError(404, 'IMAGE_NOT_FOUND');
      await s.audit(actorId, accountId, 'PRODUCT_IMAGE_REMOVED', { imageId: id });
    });
  }
}

