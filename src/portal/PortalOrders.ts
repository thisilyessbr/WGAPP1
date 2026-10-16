import { PortalStore } from './PortalStore';
import { PortalError } from './types';
import { LeadStage, PortalLeads } from './PortalLeads';

/**
 * Orders for shops: the requests a cash-on-delivery workflow completed, shown with product, quantity, delivery
 * details and a total computed from the catalog price. The delivery status (to confirm → confirmed → shipped →
 * delivered / returned / cancelled) is kept in the lead's details, and the lead stage follows it, so Follow-ups,
 * statistics and email alerts keep working unchanged.
 */
export const ORDER_STATUSES = ['NEW', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
const LEAD_STAGE_FOR: Record<OrderStatus, LeadStage> = { NEW: 'NEW', CONFIRMED: 'QUALIFIED', SHIPPED: 'QUALIFIED', DELIVERED: 'WON', RETURNED: 'LOST', CANCELLED: 'LOST' };
const ORDER_FIELDS = ['product', 'quantity', 'city', 'address', 'customerName', 'total'] as const;

export class PortalOrders {
  constructor(private store: PortalStore, private leads = new PortalLeads(store)) {}

  // One query shape for list, detail and summary: a lead from a completed order workflow, with its order fields.
  private async rows(tenantId: string, accountId: string, options: { id?: string; status?: string; since?: Date; limit?: number; offset?: number }) {
    const id = options.id ?? null, status = options.status ?? 'ALL', since = options.since ?? null;
    return this.store.db.$queryRaw<any[]>`
      WITH o AS (
        SELECT l.id,l.status AS "leadStatus",l.note,l.details,l."createdAt",l."updatedAt",l."sourcePhoneNumberId",
          cu."externalId" AS "customerPhone",cu.metadata AS "customerMetadata",
          COALESCE(l."sourceConversationId",c.id) AS "conversationId",
          COALESCE(NULLIF(l.details->>'product',''),ws."collectedData"->>'product',ws."collectedData"->>'product_name',ws."collectedData"->>'produit') AS product,
          COALESCE(NULLIF(l.details->>'quantity',''),ws."collectedData"->>'quantity',ws."collectedData"->>'quantite','1') AS quantity,
          COALESCE(NULLIF(l.details->>'city',''),ws."collectedData"->>'city',ws."collectedData"->>'ville',ws."collectedData"->>'delivery_city') AS city,
          COALESCE(NULLIF(l.details->>'address',''),ws."collectedData"->>'address',ws."collectedData"->>'adresse',ws."collectedData"->>'delivery_address') AS address,
          COALESCE(NULLIF(l.details->>'customerName',''),ws."collectedData"->>'customer_name',ws."collectedData"->>'fullName',ws."collectedData"->>'name') AS "customerName",
          COALESCE(NULLIF(ws."collectedData"->>'phone',''),cu."externalId") AS phone,
          NULLIF(l.details->>'total','') AS "totalOverride",
          COALESCE(NULLIF(l.details->>'orderStatus',''),CASE l.status WHEN 'WON' THEN 'DELIVERED' WHEN 'LOST' THEN 'CANCELLED' WHEN 'DONE' THEN 'DELIVERED' ELSE 'NEW' END) AS "orderStatus",
          COALESCE(a.config->'identity'->>'currency','MAD') AS "accountCurrency"
        FROM "Lead" l
        JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
        JOIN "Account" a ON a.id=l."accountId" AND a."tenantId"=l."tenantId"
        LEFT JOIN LATERAL (SELECT id FROM "Conversation" WHERE "tenantId"=l."tenantId" AND "accountId"=l."accountId" AND "customerId"=l."customerId" ORDER BY "updatedAt" DESC LIMIT 1) c ON TRUE
        JOIN "WorkflowSession" ws ON ws.id=l."sourceWorkflowSessionId" AND ws."tenantId"=l."tenantId" AND ws.status='COMPLETED'
          AND (ws."workflowId" ~* '(checkout|cash_on_delivery|cod_order)' OR ws."collectedData" ?| array['product','product_name','produit'])
          -- Only orders the customer confirmed (an order form ending without confirmation is not an order).
          AND (ws."collectedData"->>'_confirmed'='true' OR (ws."collectedData"->>'_confirmed' IS NULL AND ws."stateId"='done'))
        WHERE l."tenantId"=${tenantId} AND l."accountId"=${accountId} AND (${id}::text IS NULL OR l.id=${id})
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
          AND (${since}::timestamptz IS NULL OR l."createdAt">=${since}::timestamptz)
      )
      SELECT o.*,pr.price AS "unitPrice",COALESCE(pr.currency,o."accountCurrency") AS currency,
        COALESCE(CASE WHEN o."totalOverride" ~ '^[0-9]+(\\.[0-9]{1,2})?$' THEN o."totalOverride"::numeric END,
          pr.price*CASE WHEN o.quantity ~ '^[0-9]{1,4}$' THEN o.quantity::int ELSE 1 END) AS total
      FROM o LEFT JOIN LATERAL (
        SELECT p.price,p.currency FROM "Product" p WHERE p."tenantId"=${tenantId} AND p."accountId"=${accountId} AND p.active AND o.product IS NOT NULL
          AND (lower(p.name)=lower(o.product) OR lower(p.sku)=lower(o.product) OR o.product ILIKE '%'||p.name||'%')
        ORDER BY (lower(p.name)=lower(o.product)) DESC,length(p.name) DESC LIMIT 1) pr ON TRUE
      WHERE (${status}='ALL' OR o."orderStatus"=${status})
      ORDER BY CASE o."orderStatus" WHEN 'NEW' THEN 0 WHEN 'CONFIRMED' THEN 1 WHEN 'SHIPPED' THEN 2 ELSE 3 END,o."createdAt" DESC
      LIMIT ${options.limit ?? 1000} OFFSET ${options.offset ?? 0}`;
  }

  private view(row: any) {
    const total = row.total === null || row.total === undefined ? null : Number(row.total);
    return { id: row.id, status: row.orderStatus as OrderStatus, createdAt: row.createdAt, updatedAt: row.updatedAt,
      customerName: row.customerName || row.customerMetadata?.name || row.customerMetadata?.pushName || null, phone: row.phone,
      product: row.product, quantity: row.quantity, city: row.city, address: row.address, note: row.note,
      unitPrice: row.unitPrice === null || row.unitPrice === undefined ? null : Number(row.unitPrice), total, currency: row.currency || 'MAD',
      totalIsManual: Boolean(row.totalOverride), conversationId: row.conversationId };
  }

  async list(tenantId: string, accountId: string, status = 'ALL', limit = 50, offset = 0) {
    if (status !== 'ALL' && !ORDER_STATUSES.includes(status as OrderStatus)) throw new PortalError(400, 'INVALID_ORDER_STATUS');
    const [rows, all] = await Promise.all([this.rows(tenantId, accountId, { status, limit: limit + 1, offset }), this.rows(tenantId, accountId, {})]);
    const counts = Object.fromEntries(['ALL', ...ORDER_STATUSES].map(s => [s, s === 'ALL' ? all.length : all.filter(r => r.orderStatus === s).length]));
    return { orders: rows.slice(0, limit).map(r => this.view(r)), counts, hasMore: rows.length > limit };
  }

  async get(tenantId: string, accountId: string, id: string) {
    const [row] = await this.rows(tenantId, accountId, { id });
    if (!row) throw new PortalError(404, 'ORDER_NOT_FOUND');
    return this.view(row);
  }

  /** This week's orders and revenue (cancelled and returned orders excluded), and orders still to confirm. */
  async summary(tenantId: string, accountId: string, now = new Date()) {
    const since = new Date(now.getTime() - 7 * 86400000);
    const [week, all] = await Promise.all([this.rows(tenantId, accountId, { since }), this.rows(tenantId, accountId, { status: 'NEW' })]);
    const kept = week.filter(r => !['CANCELLED', 'RETURNED'].includes(r.orderStatus));
    const currency = kept.find(r => r.currency)?.currency || week[0]?.accountCurrency || 'MAD';
    return { weekOrders: kept.length, weekRevenue: Math.round(kept.reduce((sum, r) => sum + (r.total === null ? 0 : Number(r.total)), 0) * 100) / 100,
      weekWithoutPrice: kept.filter(r => r.total === null).length, toConfirm: all.length, currency };
  }

  async update(tenantId: string, accountId: string, id: string, actorId: string, body: Record<string, unknown>) {
    await this.get(tenantId, accountId, id); // 404 unless this lead is an order of this account
    const lead = await this.leads.get(tenantId, accountId, id);
    const details: Record<string, string> = { ...(lead.details && typeof lead.details === 'object' && !Array.isArray(lead.details) ? lead.details : {}) };
    let status: OrderStatus | undefined;
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !ORDER_STATUSES.includes(body.status as OrderStatus)) throw new PortalError(400, 'INVALID_ORDER_STATUS');
      status = body.status as OrderStatus; details.orderStatus = status;
    }
    for (const key of ORDER_FIELDS) {
      if (body[key] === undefined) continue;
      const value = body[key] === null ? '' : String(body[key]).trim();
      if (value.length > (key === 'address' ? 500 : 150)) throw new PortalError(400, 'INVALID_ORDER_FIELD');
      if (key === 'total' && value && !/^[0-9]+(\.[0-9]{1,2})?$/.test(value)) throw new PortalError(400, 'INVALID_ORDER_TOTAL', 'Enter the total as a number, for example 249 or 249.50.');
      if (key === 'quantity' && value && !/^[0-9]{1,4}$/.test(value)) throw new PortalError(400, 'INVALID_ORDER_QUANTITY', 'Enter the quantity as a whole number.');
      details[key] = value;
    }
    let note: string | null | undefined;
    if (body.note !== undefined) {
      if (body.note !== null && (typeof body.note !== 'string' || body.note.length > 2000)) throw new PortalError(400, 'INVALID_ORDER_NOTE');
      note = typeof body.note === 'string' ? body.note.trim() || null : null;
    }
    await this.leads.update(tenantId, accountId, id, actorId, { details, ...(status ? { status: LEAD_STAGE_FOR[status], followUpAt: null } : {}), ...(note !== undefined ? { note } : {}) });
    return this.get(tenantId, accountId, id);
  }
}
