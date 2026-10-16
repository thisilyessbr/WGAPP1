import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalOrders } from '../../src/portal/PortalOrders';

describe('shop orders', () => {
  let db: any, store: PortalStore, orders: PortalOrders;
  beforeAll(async () => { db = (await portalDatabase()).db; store = new PortalStore(db); orders = new PortalOrders(store); }, 60000);
  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM "Tenant"`;
    for (const t of ['t1', 't2']) await db.$executeRaw`INSERT INTO "Tenant"(id,name,"updatedAt") VALUES (${t},'T',NOW())`;
    await db.$executeRaw`INSERT INTO "Account"(id,"tenantId",name,config,"updatedAt") VALUES ('a1','t1','Shop','{"identity":{"currency":"MAD"}}'::jsonb,NOW()),('a2','t2','Other','{}'::jsonb,NOW())`;
    await db.$executeRaw`INSERT INTO "Product"(id,"tenantId","accountId",sku,name,description,price,currency,stock,active,"updatedAt") VALUES ('p1','t1','a1','ABY','Abaya Salma','Abaya',380,'MAD',5,true,NOW())`;
  });
  const order = async (data: Record<string, unknown>, opts: { account?: string; tenant?: string; workflowId?: string; hoursAgo?: number; details?: object; customer?: string } = {}) => {
    const t = opts.tenant || 't1', a = opts.account || 'a1', cu = randomUUID(), cv = randomUUID(), ws = randomUUID(), id = randomUUID();
    const at = new Date(Date.now() - (opts.hoursAgo ?? 1) * 3600000);
    await db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${cu},${t},${opts.customer || '2126' + Math.floor(Math.random() * 1e8)},NOW())`;
    await db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${cv},${t},${a},${cu},NOW())`;
    await db.$executeRaw`INSERT INTO "WorkflowSession"(id,"tenantId","conversationId","workflowId","stateId",status,"collectedData","updatedAt") VALUES (${ws},${t},${cv},${opts.workflowId || 'checkout_x'},'done','COMPLETED',${JSON.stringify(data)}::jsonb,NOW())`;
    await db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,details,"sourceConversationId","sourceWorkflowSessionId","createdAt","updatedAt") VALUES (${id},${t},${a},${cu},'NEW',${JSON.stringify(opts.details || {})}::jsonb,${cv},${ws},${at},${at})`;
    return id;
  };

  it('lists confirmed order requests with a total from the catalog price, and nothing from other accounts', async () => {
    await order({ product: 'Abaya Salma', quantity: '2', city: 'Casablanca', customer_name: 'Salma', _confirmed: true });
    await order({ produit: 'abaya salma', quantite: '1', ville: 'Fès', _confirmed: true });
    await order({ product: 'Unknown item', quantity: '1', _confirmed: true });
    await order({ product: 'Abaya Salma', quantity: '1', _confirmed: false }); // customer did not confirm
    await order({ name: 'Ali', request: 'Need a quote' }, { workflowId: 'contact_request' }); // not an order
    await order({ product: 'Abaya Salma', quantity: '9', _confirmed: true }, { account: 'a2', tenant: 't2' });
    const { orders: list, counts } = await orders.list('t1', 'a1', 'ALL');
    expect(counts.ALL).toBe(3);
    expect(list.map(o => [o.product, o.quantity, o.total, o.currency])).toEqual(expect.arrayContaining([
      ['Abaya Salma', '2', 760, 'MAD'], ['abaya salma', '1', 380, 'MAD'], ['Unknown item', '1', null, 'MAD']]));
    expect(list.find(o => o.quantity === '2')).toMatchObject({ status: 'NEW', city: 'Casablanca', customerName: 'Salma' });
  });

  it('moves an order through its statuses and keeps the lead stage in step', async () => {
    const id = await order({ product: 'Abaya Salma', quantity: '1', _confirmed: true });
    const stage = async () => (await db.$queryRaw`SELECT status FROM "Lead" WHERE id=${id}`)[0].status;
    await orders.update('t1', 'a1', id, 'u1', { status: 'CONFIRMED' });
    expect([(await orders.get('t1', 'a1', id)).status, await stage()]).toEqual(['CONFIRMED', 'QUALIFIED']);
    await orders.update('t1', 'a1', id, 'u1', { status: 'DELIVERED' });
    expect([(await orders.get('t1', 'a1', id)).status, await stage()]).toEqual(['DELIVERED', 'WON']);
    await orders.update('t1', 'a1', id, 'u1', { status: 'RETURNED' });
    expect(await stage()).toBe('LOST');
    await expect(orders.update('t1', 'a1', id, 'u1', { status: 'LOST' })).rejects.toMatchObject({ code: 'INVALID_ORDER_STATUS' });
    await expect(orders.update('t2', 'a2', id, 'u1', { status: 'CONFIRMED' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });

  it('lets the shop correct the quantity or set the total, and counts this week without cancelled or returned orders', async () => {
    const a = await order({ product: 'Abaya Salma', quantity: '1', _confirmed: true });
    const b = await order({ product: 'Abaya Salma', quantity: '1', _confirmed: true });
    await order({ product: 'Abaya Salma', quantity: '1', _confirmed: true }, { hoursAgo: 24 * 9 }); // last week
    expect((await orders.update('t1', 'a1', a, 'u1', { quantity: '3', note: 'After 18:00' })).total).toBe(1140);
    expect((await orders.update('t1', 'a1', a, 'u1', { total: '1000' }))).toMatchObject({ total: 1000, totalIsManual: true, note: 'After 18:00' });
    await expect(orders.update('t1', 'a1', a, 'u1', { total: 'cheap' })).rejects.toMatchObject({ code: 'INVALID_ORDER_TOTAL' });
    await orders.update('t1', 'a1', b, 'u1', { status: 'CANCELLED' });
    expect(await orders.summary('t1', 'a1')).toMatchObject({ weekOrders: 1, weekRevenue: 1000, toConfirm: 2, currency: 'MAD' });
  });
});
