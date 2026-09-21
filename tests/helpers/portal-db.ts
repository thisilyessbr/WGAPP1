import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PortalDb } from '../../src/portal/types';

export async function portalDatabase() {
  const pg = new PGlite();
  const root = resolve('prisma/migrations');
  for (const dir of readdirSync(root).filter(d => /^\d/.test(d)).sort()) {
    // Portal tests exercise real PostgreSQL SQL/constraints. Vector similarity is covered separately.
    const sql = readFileSync(resolve(root, dir, 'migration.sql'), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS "vector";/g, '')
      .replace(/"embedding" vector\b/g, '"embedding" double precision[]');
    await pg.exec(sql);
  }
  const adapter = (connection: any, inTransaction = false): PortalDb => ({
    async $queryRaw(strings, ...values) {
      const sql = strings.reduce((s, part, i) => s + (i ? '$' + i : '') + part, '');
      const result = await connection.query(sql, values.map(v => v instanceof Date ? v.toISOString() : v));
      return result.rows;
    },
    async $executeRaw(strings, ...values) {
      const sql = strings.reduce((s, part, i) => s + (i ? '$' + i : '') + part, '');
      return (await connection.query(sql, values.map(v => v instanceof Date ? v.toISOString() : v))).affectedRows;
    },
    async $transaction(fn) { return inTransaction ? fn(adapter(connection, true)) : pg.transaction(tx => fn(adapter(tx, true))); }
  });
  return { pg, db: adapter(pg) };
}
