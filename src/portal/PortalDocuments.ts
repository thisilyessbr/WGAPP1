import { createHash, randomUUID } from 'crypto';
import { PdfIngestionService, isValidPdfBuffer } from '../domain/rag/PdfIngestionService';
import { AccountConfigService } from '../domain/tenant/AccountConfigService';
import { PortalStore } from './PortalStore';
import { PortalBudget } from './PortalBudget';
import { PortalError } from './types';

export class PortalDocuments {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private store: PortalStore, private budget: PortalBudget, private ingestion: PdfIngestionService, private configs: AccountConfigService) {}
  async list(accountId: string) { return this.store.db.$queryRaw<any[]>`SELECT id,filename,size,status,"sourceId",error,"createdAt" FROM "PortalDocument" WHERE "accountId"=${accountId} ORDER BY "createdAt" DESC LIMIT 100`; }
  async upload(actorId: string, accountId: string, filename: string, buffer: Buffer) {
    if (!isValidPdfBuffer(buffer) || buffer.length > 10 * 1048576) throw new PortalError(400, 'INVALID_PDF', 'Choose a PDF up to 10 MB.');
    const name = filename.replace(/.*[\\/]/, '').replace(/[\u0000-\u001f]/g, '').slice(0, 180) || 'document.pdf';
    const hash = createHash('sha256').update(buffer).digest('hex');
    return this.store.transaction(async s => {
      const profile = await s.lockProfile(accountId);
      if (profile.editingFrozen) throw new PortalError(403, 'CLIENT_EDITING_FROZEN', 'Chatbot information is locked by the administrator.');
      const plan = profile.planSnapshot || (profile.requestedPlanId ? await s.plan(profile.requestedPlanId) : null);
      if (!plan?.modules.includes('knowledge') || profile.status === 'SUSPENDED') throw new PortalError(403, 'KNOWLEDGE_NOT_INCLUDED');
      const existing = (await s.db.$queryRaw<any[]>`SELECT id FROM "PortalDocument" WHERE "accountId"=${accountId} AND hash=${hash}`)[0];
      if (existing) return { id: existing.id, reused: true };
      const usage = (await s.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS count,COALESCE(SUM(size),0)::bigint AS bytes FROM "PortalDocument" WHERE "accountId"=${accountId}`)[0];
      if (usage.count >= plan.limits.documents || Number(usage.bytes) + buffer.length > plan.limits.storageMb * 1048576) throw new PortalError(402, 'DOCUMENT_ALLOWANCE_REACHED');
      const id = randomUUID();
      await s.db.$executeRaw`INSERT INTO "PortalDocument"(id,"accountId",filename,hash,bytes,size) VALUES (${id},${accountId},${name},${hash},${buffer},${buffer.length})`;
      await s.audit(actorId, accountId, 'DOCUMENT_UPLOADED', { documentId: id, size: buffer.length });
      return { id, reused: false };
    });
  }
  async queue(actorId: string, accountId: string, documentId: string) {
    await this.store.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (!p.planSnapshot?.modules.includes('knowledge') || !p.published || p.status === 'SUSPENDED') throw new PortalError(403, 'PUBLISH_BUSINESS_FIRST');
      const count = await s.db.$executeRaw`UPDATE "PortalDocument" SET status='QUEUED',error=NULL WHERE id=${documentId} AND "accountId"=${accountId} AND status IN ('PENDING','FAILED')`;
      if (!count) throw new PortalError(409, 'DOCUMENT_ALREADY_PROCESSING');
      await s.audit(actorId, accountId, 'DOCUMENT_INDEX_APPROVED', { documentId });
    });
  }
  async remove(actorId: string, accountId: string, documentId: string, admin: boolean) {
    await this.store.transaction(async s => {
      const p = await s.lockProfile(accountId);
      const d = (await s.db.$queryRaw<any[]>`SELECT * FROM "PortalDocument" WHERE id=${documentId} AND "accountId"=${accountId} FOR UPDATE`)[0];
      if (!d) throw new PortalError(404, 'DOCUMENT_NOT_FOUND');
      if (!admin && p.editingFrozen) throw new PortalError(403, 'CLIENT_EDITING_FROZEN', 'Chatbot information is locked by the administrator.');
      if (['PROCESSING', 'QUEUED'].includes(d.status) || (!admin && d.sourceId)) throw new PortalError(409, 'DOCUMENT_REQUIRES_ADMIN', 'Ask your administrator to remove a published document.');
      if (d.sourceId) await s.db.$executeRaw`DELETE FROM "KnowledgeSource" WHERE id=${d.sourceId} AND "tenantId"=${p.tenantId} AND "accountId"=${accountId}`;
      await s.db.$executeRaw`DELETE FROM "PortalDocument" WHERE id=${documentId} AND "accountId"=${accountId}`;
      await s.audit(actorId, accountId, 'DOCUMENT_REMOVED', { documentId });
    });
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 5000); this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      await this.store.db.$executeRaw`UPDATE "PortalDocument" SET status='FAILED',error='Worker interrupted. Review before retrying.' WHERE status='PROCESSING' AND "leaseUntil"<NOW()`;
      const job = await this.store.transaction(async s => {
        const row = (await s.db.$queryRaw<any[]>`SELECT * FROM "PortalDocument" WHERE status='QUEUED' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`)[0];
        if (row) await s.db.$executeRaw`UPDATE "PortalDocument" SET status='PROCESSING',"leaseUntil"=NOW()+INTERVAL '2 hours' WHERE id=${row.id}`;
        return row;
      });
      if (!job) return;
      try {
        const profile = await this.store.profile(job.accountId);
        const config = await this.configs.getEffectiveConfig(profile.tenantId, profile.accountId);
        const sourceId = await this.budget.runIngestion(profile, job.id, () => this.ingestion.ingestPdf(profile.tenantId, Buffer.from(job.bytes), job.filename, config, profile.accountId));
        await this.store.db.$executeRaw`UPDATE "PortalDocument" SET status='READY',"sourceId"=${sourceId},"leaseUntil"=NULL WHERE id=${job.id} AND status='PROCESSING'`;
      } catch (error) {
        const message = error instanceof PortalError ? error.message : 'Indexing failed. Check PDF contents, embedding provider and account allowance.';
        await this.store.db.$executeRaw`UPDATE "PortalDocument" SET status='FAILED',error=${message},"leaseUntil"=NULL WHERE id=${job.id}`;
      }
    } finally { this.busy = false; }
  }
}
