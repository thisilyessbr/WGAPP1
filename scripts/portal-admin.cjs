#!/usr/bin/env node
'use strict';
if (process.argv.includes('--help')) {
  console.log('Create the first portal administrator after migrating and building.\nRun: npm run portal:admin\nPrompts for email, name and a hidden password.\nAutomation: PORTAL_ADMIN_EMAIL, PORTAL_ADMIN_NAME, PORTAL_ADMIN_PASSWORD.\nUse --additional explicitly to create another administrator. Existing users are never promoted or overwritten.');
  process.exit(0);
}
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { Writable } = require('stream');
const readline = require('readline');
const { hashPassword } = require('../dist/src/portal/PortalAuth');

async function prompt(question, secret = false) {
  if (!process.stdin.isTTY) throw Error('Interactive terminal required, or supply PORTAL_ADMIN_EMAIL and PORTAL_ADMIN_PASSWORD securely.');
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise(resolve => { rl.question(question, answer => { muted = false; rl.close(); if (secret) process.stdout.write('\n'); resolve(answer); }); muted = secret; });
}
async function main() {
  const email = (process.env.PORTAL_ADMIN_EMAIL || await prompt('Administrator email: ')).trim().toLowerCase();
  const name = (process.env.PORTAL_ADMIN_NAME || await prompt('Administrator name: ')).trim();
  const password = process.env.PORTAL_ADMIN_PASSWORD || await prompt('Password (12–256 characters, hidden): ', true);
  delete process.env.PORTAL_ADMIN_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 160) throw Error('Invalid administrator email or name.');
  const passwordHash = await hashPassword(password);
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw Error('DATABASE_URL or DIRECT_URL is required.');
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10000 });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('relayqo-portal-admin-bootstrap'))");
    const admins = await db.query('SELECT id FROM "PortalUser" WHERE role=$1 LIMIT 1', ['ADMIN']);
    if (admins.rowCount && !process.argv.includes('--additional')) throw Error('An administrator already exists. Use its login, or explicitly pass --additional.');
    const id = randomUUID();
    await db.query('INSERT INTO "PortalUser"(id,email,name,"passwordHash",role,"verifiedAt") VALUES ($1,$2,$3,$4,$5,NOW())', [id,email,name,passwordHash,'ADMIN']);
    await db.query('INSERT INTO "PortalAudit"(id,"actorId",action,metadata) VALUES ($1,$2,$3,$4::jsonb)', [randomUUID(),id,'ADMIN_BOOTSTRAPPED',JSON.stringify({method:'server-console'})]);
    await db.query('COMMIT');
    console.log('Administrator created. Log in at /login; the email confirmation step is required.');
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); await pool.end(); }
}
main().catch(error=>{ console.error(error.code === '23505' ? 'That email already exists. No user was changed.' : error.code ? 'Administrator setup failed ('+error.code+'). Check the migration and database connection.' : error.message);process.exitCode=1; });
