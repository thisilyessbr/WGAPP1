import { randomUUID } from 'crypto';
import { ChatbotDependencies } from '../bootstrap';
import { PortalStore } from './PortalStore';
import { PortalError, PortalPrincipal } from './types';

export class PortalConnections {
  constructor(private store: PortalStore, private deps: Pick<ChatbotDependencies, 'whatsAppOnboardingService' | 'qrSessionManager' | 'whatsAppNumberService' | 'prisma'>) {}
  async begin(principal: PortalPrincipal, reconnectId?: string) {
    const accountId = principal.accountId!, userId = principal.user.id;
    if (!this.deps.whatsAppOnboardingService) throw new PortalError(503, 'WHATSAPP_NOT_CONFIGURED');
    if (!process.env.META_APP_ID || !process.env.META_CONFIG_ID) throw new PortalError(503, 'WHATSAPP_SETUP_REQUIRED', 'The administrator must finish WhatsApp setup first.');
    return this.store.transaction(async s => {
      const profile = await s.lockProfile(accountId);
      if (profile.tenantId !== principal.tenantId || !profile.planSnapshot || profile.status === 'SUSPENDED') throw new PortalError(403, 'PLAN_APPROVAL_REQUIRED');
      await s.db.$executeRaw`UPDATE "PortalConnectionAttempt" SET status='EXPIRED' WHERE "accountId"=${accountId} AND status='PENDING' AND "expiresAt"<NOW()`;
      const connections = await s.connections(accountId, profile.tenantId);
      if (reconnectId && !connections.some(c => c.id === reconnectId && c.provider === 'META_CLOUD')) throw new PortalError(404, 'CONNECTION_NOT_FOUND');
      const resumable = await s.db.$queryRaw<any[]>`SELECT * FROM "PortalConnectionAttempt" WHERE "accountId"=${accountId} AND "userId"=${userId}
        AND "reconnectId" IS NOT DISTINCT FROM ${reconnectId || null} AND status='PENDING' AND "expiresAt">NOW() ORDER BY "createdAt" DESC LIMIT 1`;
      if (resumable.length) return {
        attemptId: resumable[0].id, stateToken: resumable[0].stateToken,
        appId: process.env.META_APP_ID, configId: process.env.META_CONFIG_ID,
        graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0'
      };
      const pending = await s.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "PortalConnectionAttempt" WHERE "accountId"=${accountId} AND status IN ('PENDING','PROCESSING')`;
      if (connections.filter(c => c.numberRecordId && c.id !== reconnectId).length + pending[0].n >= profile.planSnapshot.limits.numbers) throw new PortalError(409, 'NUMBER_ALLOWANCE_REACHED', 'The number allowance is already in use. Ask your administrator to review it.');
      await s.throttle('wa-start:' + accountId, 5, 900);
      const id = randomUUID(), stateToken = this.deps.whatsAppOnboardingService!.generateSignupState(profile.tenantId, accountId);
      await s.db.$executeRaw`INSERT INTO "PortalConnectionAttempt"(id,"userId","accountId","stateToken","reconnectId","expiresAt") VALUES (${id},${userId},${accountId},${stateToken},${reconnectId || null},${new Date(Date.now() + 600000)})`;
      await s.audit(userId, accountId, 'WHATSAPP_LINK_STARTED');
      return { attemptId: id, stateToken, appId: process.env.META_APP_ID, configId: process.env.META_CONFIG_ID, graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0' };
    });
  }
  async complete(principal: PortalPrincipal, input: any) {
    const attempt = await this.store.transaction(async s => {
      const profile = await s.lockProfile(principal.accountId!);
      if (!profile.planSnapshot || profile.status === 'SUSPENDED') throw new PortalError(403, 'PLAN_APPROVAL_REQUIRED');
      const rows = await s.db.$queryRaw<any[]>`UPDATE "PortalConnectionAttempt" SET status='PROCESSING' WHERE id=${input.attemptId} AND "userId"=${principal.user.id}
        AND "accountId"=${principal.accountId!} AND "stateToken"=${input.stateToken} AND status='PENDING' AND "expiresAt">NOW() RETURNING *`;
      if (!rows.length) throw new PortalError(400, 'CONNECTION_ATTEMPT_EXPIRED', 'Restart the WhatsApp connection step.');
      const connections = await s.connections(principal.accountId!, principal.tenantId!);
      const reconnectId = rows[0].reconnectId;
      if (reconnectId && !connections.some(c => c.id === reconnectId && c.phoneNumberId === input.phoneNumberId)) throw new PortalError(400, 'RECONNECT_SAME_NUMBER', 'Select the same WhatsApp number when reconnecting.');
      if (connections.filter(c => c.numberRecordId && c.id !== reconnectId).length >= profile.planSnapshot.limits.numbers) throw new PortalError(409, 'NUMBER_ALLOWANCE_REACHED');
      return rows[0];
    });
    try {
      const result = await this.deps.whatsAppOnboardingService!.processEmbeddedSignupCallback({
        tenantId: principal.tenantId!, accountId: principal.accountId!, code: input.code,
        wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, stateToken: attempt.stateToken,
        displayPhoneNumber: input.displayPhoneNumber, pin: input.pin
      });
      if (!result.success) throw new PortalError(400, 'WHATSAPP_CONNECTION_FAILED', 'WhatsApp could not be connected. Check the business account permissions and try again.');
      await this.store.db.$executeRaw`UPDATE "PortalConnectionAttempt" SET status='COMPLETED' WHERE id=${attempt.id}`;
      await this.store.audit(principal.user.id, principal.accountId!, 'WHATSAPP_CONNECTED');
      return { success: true, connections: await this.store.connections(principal.accountId!, principal.tenantId!) };
    } catch (error) {
      // Failed attempts need explicit restart; never replay an OAuth code automatically.
      await this.store.db.$executeRaw`UPDATE "PortalConnectionAttempt" SET status='FAILED' WHERE id=${attempt.id}`;
      throw error;
    }
  }
  async reconnect(principal: PortalPrincipal, connectionId: string) {
    const rows = await this.store.connections(principal.accountId!, principal.tenantId!);
    const connection = rows.find(c => c.id === connectionId);
    if (!connection) throw new PortalError(404, 'CONNECTION_NOT_FOUND');
    await this.store.audit(principal.user.id, principal.accountId!, 'WHATSAPP_RECONNECTION_REQUESTED', { connectionId });
    if (connection.provider === 'META_CLOUD') return this.begin(principal, connectionId);
    if (!principal.accountId || !(await this.store.profile(principal.accountId)).planSnapshot?.modules.includes('qr')) throw new PortalError(403, 'QR_NOT_INCLUDED');
    if (!connection.enabled) throw new PortalError(403, 'CONNECTION_PAUSED');
    await this.deps.qrSessionManager?.start(connectionId);
    return { connectionId, qr: this.deps.qrSessionManager?.getQr(connectionId) || null };
  }
  async startQr(principal: PortalPrincipal) {
    if (!this.deps.qrSessionManager?.isEnabled()) throw new PortalError(503, 'QR_NOT_CONFIGURED');
    const attemptId = await this.store.transaction(async s => {
      const p = await s.lockProfile(principal.accountId!);
      if (p.tenantId !== principal.tenantId || p.status === 'SUSPENDED' || !p.planSnapshot?.modules.includes('qr')) throw new PortalError(403, 'QR_NOT_INCLUDED');
      const existing = await s.connections(p.accountId, p.tenantId);
      const pending = await s.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "PortalConnectionAttempt" WHERE "accountId"=${p.accountId} AND (status='PROCESSING' OR (status='PENDING' AND "expiresAt">NOW()))`;
      if (existing.filter(c => c.numberRecordId).length + pending[0].n >= p.planSnapshot.limits.numbers) throw new PortalError(409, 'NUMBER_ALLOWANCE_REACHED');
      const id = randomUUID();
      await s.db.$executeRaw`INSERT INTO "PortalConnectionAttempt"(id,"userId","accountId","stateToken",status,"expiresAt") VALUES (${id},${principal.user.id},${p.accountId},'QR','PROCESSING',NOW()+INTERVAL '10 minutes')`;
      return id;
    });
    try {
      const result = await this.deps.qrSessionManager.createConnection(principal.tenantId!, principal.accountId!);
      await this.store.db.$executeRaw`UPDATE "PortalConnectionAttempt" SET status='COMPLETED' WHERE id=${attemptId}`;
      await this.store.audit(principal.user.id, principal.accountId!, 'QR_LINK_STARTED', { connectionId: result.connection.id });
      return { connectionId: result.connection.id, qr: this.deps.qrSessionManager.getQr(result.connection.id) };
    } catch (error) {
      await this.store.db.$executeRaw`UPDATE "PortalConnectionAttempt" SET status='FAILED' WHERE id=${attemptId}`;
      throw error;
    }
  }
  async qr(principal: PortalPrincipal, connectionId: string) {
    const profile = await this.store.profile(principal.accountId!, principal.tenantId!);
    if (profile.status === 'SUSPENDED' || !profile.planSnapshot?.modules.includes('qr')) throw new PortalError(403, 'QR_NOT_INCLUDED');
    const rows = await this.store.connections(principal.accountId!, principal.tenantId!);
    if (!rows.some(c => c.id === connectionId && c.enabled && c.provider === 'QR_WEB')) throw new PortalError(404, 'CONNECTION_NOT_FOUND');
    return { qr: this.deps.qrSessionManager?.getQr(connectionId) || null, connections: rows };
  }
}
