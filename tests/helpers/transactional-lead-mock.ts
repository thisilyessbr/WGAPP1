/** Upgrade older classification fixtures to model transactional open-request lookup.
 * The legacy creation spy is retained so those tests still verify the number of writes.
 * Database locking, closed history and session idempotency are tested against PostgreSQL separately.
 */
export function transactionalLeadMock(db: any) {
  const rows: any[] = [];
  const legacyCreate = db.lead.upsert;
  db.$queryRaw ||= async () => [{ id: 'fixture-customer' }];
  db.lead.findFirst = async ({ where }: any) => rows.find(row =>
    Object.entries(where).every(([key, value]: any) => value && typeof value === 'object' && value.in
      ? value.in.includes(row[key]) : row[key] === value)) || null;
  db.lead.create = async ({ data }: any) => {
    const result = await legacyCreate({ create: data, update: {},
      where: { tenantId_accountId_customerId: { tenantId: data.tenantId, accountId: data.accountId, customerId: data.customerId } } });
    const row = { ...data, ...result };
    rows.push(row); return row;
  };
  db.lead.update = async ({ where, data }: any) => {
    const row = rows.find(row => row.id === where.id);
    if (!row) throw new Error('Lead fixture not found');
    return Object.assign(row, data);
  };
  db.$transaction ||= async (fn: any) => fn(db);
  return db;
}
