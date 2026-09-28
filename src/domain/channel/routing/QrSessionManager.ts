import { PrismaClient, ChannelConnection } from '@prisma/client';
import type { WASocket } from '@whiskeysockets/baileys' with { "resolution-mode": "import" };
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import { MessageQueue, InboundQueueJob } from '../whatsapp/MessageQueue';
import { WhatsAppNumberService } from '../whatsapp/WhatsAppNumberService';
import { SecretBox } from '../../../core/security/SecretBox';
import { PrismaBaileysAuthStore } from './PrismaBaileysAuthStore';
import { logger } from '../../../utils/logger';
import { qrEntitled, qrPhone, qrReconnectDelay } from './QrPolicy';
import { QrSessionOwnership } from './QrSessionOwnership';

interface LiveQrSession {
  socket: WASocket;
  qrDataUrl: string | null;
  qrExpiresAt: number | null;
  clearAuth: () => Promise<void>;
  heartbeat?: ReturnType<typeof setInterval>;
}

export class QrSessionManager {
  private readonly sessions = new Map<string, LiveQrSession>();
  private readonly authStore: PrismaBaileysAuthStore;
  private readonly enabled: boolean;
  private readonly ownership: QrSessionOwnership;
  private readonly starting = new Map<string, Promise<void>>();
  private readonly retries = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly openedAt = new Map<string,number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly numberService: WhatsAppNumberService,
    private readonly queue: MessageQueue<InboundQueueJob>,
    secretBox: SecretBox,
    enabled = process.env.ENABLE_QR_CHANNELS === 'true'
  ) {
    this.authStore = new PrismaBaileysAuthStore(prisma, secretBox);
    this.enabled = enabled;
    this.ownership = new QrSessionOwnership(prisma,secretBox);
  }

  private async permitted(connection:ChannelConnection, activeOnly=false) {
    const p=await this.prisma.portalProfile.findUnique({where:{accountId:connection.accountId}});
    return connection.enabled && connection.provider==='QR_WEB' && p?.tenantId===connection.tenantId && qrEntitled(p)
      && (!activeOnly || p?.status==='ACTIVE') && !await this.numberService.isEmergencyQrStopped();
  }
  private stopLocal(id:string) {
    const timer=this.retryTimers.get(id);if(timer)clearTimeout(timer);this.retryTimers.delete(id);
    const live=this.sessions.get(id);this.sessions.delete(id);
    if(live){if(live.heartbeat)clearInterval(live.heartbeat);live.socket.end(new Error('QR session stopped'));}
  }
  private async pause(connection:ChannelConnection,status:string,error:string) {
    await this.prisma.whatsAppBusinessNumber.updateMany({where:{connectionId:connection.id},data:{enabled:false,status}});
    await this.numberService.updateConnectionStatus(connection.id,connection.tenantId,status==='PAUSED'?'SUSPENDED':status,error);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async createConnection(tenantId: string, accountId: string, label?: string): Promise<{
    connection: ChannelConnection;
    phoneNumberId: string;
  }> {
    if (!this.enabled) {
      throw new Error('QR channels are disabled. Set ENABLE_QR_CHANNELS=true only on the dedicated long-running QR worker.');
    }
    if (await this.numberService.isEmergencyQrStopped()) {
      throw new Error('Emergency QR stop is active. Clear it before starting a QR session.');
    }

    const profile=await this.prisma.portalProfile.findUnique({where:{accountId}});
    if(profile?.tenantId!==tenantId || !qrEntitled(profile))throw new Error('QR_NOT_ALLOWED');

    const sessionKey = randomUUID();
    const connection = await this.numberService.createOrUpdateConnection({
      tenantId,
      accountId,
      provider: 'QR_WEB',
      connectionKey: sessionKey,
      sessionKey,
      status: 'PENDING',
      enabled: true
    });
    const phoneNumberId = `qr:${sessionKey}`;
    await this.numberService.registerNumber({
      tenantId,
      accountId,
      phoneNumberId,
      displayPhoneNumber: label?.trim() || 'QR pending scan',
      status: 'PENDING',
      enabled: false,
      transport: 'QR_WEB',
      connectionId: connection.id
    });
    try {await this.start(connection.id);}catch(error){await this.pause(connection,'FAILED','QR session could not start.');throw error;}
    return { connection, phoneNumberId };
  }

  start(connectionId:string):Promise<void> {
    const running=this.starting.get(connectionId);if(running)return running;
    const promise=this.startSession(connectionId).finally(()=>this.starting.delete(connectionId));
    this.starting.set(connectionId,promise);return promise;
  }
  private async startSession(connectionId: string): Promise<void> {
    if (!this.enabled) return;
    if(this.sessions.has(connectionId)) {
      const current=await this.prisma.channelConnection.findUnique({where:{id:connectionId}});
      if(current && current.status!=='PENDING' && await this.permitted(current) && await this.ownership.owns(connectionId))return;
      this.stopLocal(connectionId);
      await this.ownership.release(connectionId);
    }
    if (await this.numberService.isEmergencyQrStopped()) return;

    const connection = await this.prisma.channelConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.provider !== 'QR_WEB' || !connection.enabled) return;
    if(!await this.permitted(connection)||!await this.ownership.claim(connectionId))return;

    try {
    const auth = await this.authStore.createState(connection.id);
    const { default: makeWASocket, Browsers, DisconnectReason } = await import('@whiskeysockets/baileys');
    const socket = makeWASocket({
      auth: auth.state,
      browser: Browsers.ubuntu('Relayqo'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    const live: LiveQrSession = { socket, qrDataUrl: null, qrExpiresAt: null, clearAuth: auth.clear };
    this.sessions.set(connection.id, live);
    let refreshing=false;
    live.heartbeat=setInterval(()=>{if(refreshing)return;refreshing=true;void(async()=>{
      const current=await this.prisma.channelConnection.findUnique({where:{id:connectionId}});
      if(!current || !await this.permitted(current)) {this.stopLocal(connectionId);await this.ownership.release(connectionId);if(current)await this.pause(current,'PAUSED','QR access disabled.');return;}
      if(!await this.ownership.renew(connectionId))this.stopLocal(connectionId);
    })().catch(()=>this.stopLocal(connectionId)).finally(()=>{refreshing=false;});},20000);live.heartbeat.unref();

    socket.ev.on('creds.update',()=>{if(this.sessions.get(connectionId)?.socket===socket)void auth.saveCreds().catch(()=>this.stopLocal(connectionId));});
    socket.ev.on('connection.update', async update => {
      if(this.sessions.get(connectionId)?.socket!==socket)return;
      try {
        if (update.qr) {
          live.qrDataUrl = await QRCode.toDataURL(update.qr, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
          live.qrExpiresAt = Date.now() + 60_000;
          await this.ownership.saveQr(connectionId,live.qrDataUrl);
          await this.numberService.updateConnectionStatus(connection.id, connection.tenantId, 'QR_REQUIRED');
        }

        if (update.connection === 'open') {
          live.qrDataUrl = null;
          live.qrExpiresAt = null;
          const current=await this.prisma.channelConnection.findUnique({where:{id:connectionId}});
          if(!current || !await this.permitted(current)||!await this.ownership.owns(connectionId)){this.stopLocal(connectionId);return;}
          const display=qrPhone(socket.user?.id||'');if(!display)throw new Error('QR_PHONE_UNAVAILABLE');
          await this.prisma.$transaction(async tx=>{
            const other=await tx.$queryRaw<any[]>`SELECT id FROM "WhatsAppBusinessNumber" WHERE "connectionId" IS DISTINCT FROM ${connectionId}
              AND regexp_replace("displayPhoneNumber",'[^0-9]','','g')=${display} LIMIT 1`;
            if(other.length)throw new Error('QR_NUMBER_ALREADY_CONNECTED');
            await tx.qrPhoneClaim.upsert({where:{connectionId},create:{connectionId,phone:display},update:{phone:display}});
          });
          await this.ownership.saveQr(connectionId,null);
          await this.numberService.updateConnectionStatus(connection.id, connection.tenantId, 'CONNECTED');
          await this.prisma.whatsAppBusinessNumber.updateMany({
            where: { connectionId: connection.id, tenantId: connection.tenantId },
            data: { status: 'CONNECTED', enabled: true, displayPhoneNumber: display }
          });
          this.openedAt.set(connectionId,Date.now());
        }

        if (update.connection === 'close') {
          this.stopLocal(connectionId);await this.ownership.release(connectionId);
          const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
          const loggedOut = [DisconnectReason.loggedOut,DisconnectReason.connectionReplaced,DisconnectReason.badSession,403].includes(code);
          if(loggedOut)await auth.clear();
          if(Date.now()-(this.openedAt.get(connectionId)||Date.now())>=600000)this.retries.delete(connectionId);
          this.openedAt.delete(connectionId);
          await this.prisma.whatsAppBusinessNumber.updateMany({
            where: { connectionId: connection.id },
            data: { status: loggedOut ? 'DISCONNECTED' : 'RECONNECTING', enabled: false }
          });
          await this.numberService.updateConnectionStatus(
            connection.id,
            connection.tenantId,
            loggedOut ? 'DISCONNECTED' : 'RECONNECTING',
            loggedOut ? 'WhatsApp linked device was logged out' : 'QR socket disconnected'
          );
          if (!loggedOut) {
            const attempt=this.retries.get(connectionId)||0,delay=qrReconnectDelay(attempt);
            if(delay===null){await this.pause(connection,'FAILED','Repeated disconnects. Review before reconnecting.');return;}
            this.retries.set(connectionId,attempt+1);
            const timer=setTimeout(()=>{this.retryTimers.delete(connectionId);void this.start(connectionId).catch(()=>this.pause(connection,'FAILED','QR restart failed.').catch(()=>{}));},delay);
            timer.unref();this.retryTimers.set(connectionId,timer);
          }
        }
      } catch (error: any) {
        this.stopLocal(connectionId);await this.ownership.release(connectionId).catch(()=>{});
        await this.pause(connection,'FAILED','QR connection requires review; the number may already be connected.').catch(()=>{});
        logger.warn(`QR connection ${connectionId} stopped safely.`);
      }
    });

    socket.ev.on('messages.upsert', async event => {
      if(event.type!=='notify' || this.sessions.get(connectionId)?.socket!==socket)return;
      for (const message of event.messages) {
        try {
          if (message.key.fromMe || !message.key.remoteJid || message.key.remoteJid.endsWith('@g.us') || message.key.remoteJid === 'status@broadcast') continue;
          const content = message.message;
          const text = content?.conversation || content?.extendedTextMessage?.text || '';
          if (!text.trim() || text.length>4096 || !message.key.id) continue;
          const waId=qrPhone((message.key as any).remoteJidAlt||message.key.remoteJid||'');if(!waId)continue;
          const current=await this.prisma.channelConnection.findUnique({where:{id:connectionId}});
          if(!current || !await this.permitted(current,true)||!await this.ownership.owns(connectionId))continue;
          const mapping = await this.prisma.whatsAppBusinessNumber.findFirst({ where: { connectionId: connection.id,tenantId:connection.tenantId,accountId:connection.accountId, enabled: true } });
          if (!mapping) continue;
          const rawTimestamp = Number(message.messageTimestamp || Date.now());
          const timestamp = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
          if(!Number.isFinite(timestamp)||timestamp<Date.now()-86400000||timestamp>Date.now()+60000)continue;
          await this.prisma.$executeRaw`INSERT INTO "QrContactWindow"("connectionId",recipient,"lastInboundAt") VALUES (${connectionId},${waId},${new Date(timestamp)})
            ON CONFLICT("connectionId",recipient) DO UPDATE SET "lastInboundAt"=GREATEST("QrContactWindow"."lastInboundAt",EXCLUDED."lastInboundAt")`;
          const wamid=`qr:${connectionId}:${message.key.id}`;
          const partitionKey = `${connection.tenantId}:${connection.accountId}:${waId}`;
          await this.queue.enqueue({
            id: wamid,
            partitionKey,
            tenantId: connection.tenantId,
            accountId: connection.accountId,
            phoneNumberId: mapping.phoneNumberId,
            waId,
            wamid,
            message: text.trim(),
            timestamp,
            rawType: 'QR_WEB_TEXT',
            enqueuedAt: Date.now()
          }, partitionKey);
        } catch (error: any) {
          logger.error(`QrSessionManager: inbound QR message failed for [${connection.id}]: ${error.message || error}`);
        }
      }
    });
    }catch(error){await this.ownership.release(connectionId).catch(()=>{});throw error;}
  }

  async restoreEnabledSessions(): Promise<void> {
    if (!this.enabled) return;
    const connections = await this.prisma.channelConnection.findMany({
      where: { provider: 'QR_WEB', enabled: true, status: { in: ['CONNECTED', 'RECONNECTING', 'QR_REQUIRED', 'PENDING'] } }
    });
    for (const connection of connections) {
      await this.start(connection.id).catch(()=>this.pause(connection,'FAILED','QR restore failed.'));
    }
  }

  async suspendAll(): Promise<void> {
    for (const [connectionId, live] of this.sessions) {
      this.stopLocal(connectionId);await this.ownership.release(connectionId);
    }
    await this.prisma.whatsAppBusinessNumber.updateMany({
      where: { transport: 'QR_WEB' },
      data: { enabled: false, status: 'EMERGENCY_STOPPED' }
    });
  }

  getQr(connectionId: string) {
    return this.ownership.getQr(connectionId);
  }

  async send(connectionId: string, recipient: string, text: string, scope: { tenantId: string; accountId: string; phoneNumberId: string }): Promise<{ id: string | null }> {
    if (!this.enabled || await this.numberService.isEmergencyQrStopped()) {
      throw new Error('QR delivery is disabled by feature flag or emergency stop');
    }
    const live = this.sessions.get(connectionId);
    if (!live) throw new Error('QR session is not active on this worker');
    const connection=await this.prisma.channelConnection.findUnique({where:{id:connectionId}});
    if (!scope || connection?.tenantId !== scope.tenantId || connection?.accountId !== scope.accountId) throw new Error('QR_SCOPE_CHANGED');
    if(!connection || connection.status!=='CONNECTED'||!await this.permitted(connection,true)||!await this.ownership.owns(connectionId))throw new Error('QR_NOT_ALLOWED');
    const mapping = await this.prisma.whatsAppBusinessNumber.findFirst({ where: { connectionId, tenantId: scope.tenantId, accountId: scope.accountId, phoneNumberId: scope.phoneNumberId, enabled: true } });
    if (!mapping) throw new Error('QR_SCOPE_CHANGED');
    const phone=qrPhone(recipient.includes('@')?recipient:`${recipient}@s.whatsapp.net`);
    if(!phone||!text.trim()||text.length>4096)throw new Error('QR_INVALID_MESSAGE');
    const window=await this.prisma.qrContactWindow.findUnique({where:{connectionId_recipient:{connectionId,recipient:phone}}});
    if(!window || window.lastInboundAt.getTime()<Date.now()-86400000)throw new Error('QR_CUSTOMER_MESSAGE_REQUIRED');
    await this.prisma.$transaction(async tx=>{
      for(const [key,max] of [[`qr-send:${connectionId}`,12],[`qr-send:${connectionId}:${phone}`,4]] as const){
        const rows=await tx.$queryRaw<any[]>`INSERT INTO "PortalThrottle"(key,count,"resetsAt") VALUES (${key},1,NOW()+INTERVAL '1 minute')
          ON CONFLICT(key) DO UPDATE SET count=CASE WHEN "PortalThrottle"."resetsAt"<=NOW() THEN 1 ELSE "PortalThrottle".count+1 END,
          "resetsAt"=CASE WHEN "PortalThrottle"."resetsAt"<=NOW() THEN NOW()+INTERVAL '1 minute' ELSE "PortalThrottle"."resetsAt" END RETURNING count`;
        if(rows[0].count>max)throw new Error('QR_RATE_LIMIT');
      }
    });
    // Throttling awaits database work; ownership or activation may change meanwhile.
    const finalConnection = await this.prisma.channelConnection.findUnique({ where: { id: connectionId } });
    if (!finalConnection || finalConnection.tenantId !== scope.tenantId || finalConnection.accountId !== scope.accountId
      || finalConnection.status !== 'CONNECTED' || !await this.permitted(finalConnection,true) || !await this.ownership.owns(connectionId)) throw new Error('QR_SCOPE_CHANGED');
    try{const result=await live.socket.sendMessage(`${phone}@s.whatsapp.net`,{text});if(!result?.key?.id)throw new Error();return {id:result.key.id};}
    catch{throw new Error('QR_SEND_OUTCOME_UNKNOWN');}
  }

  async disconnect(connection: ChannelConnection): Promise<void> {
    await this.numberService.disconnectConnection(connection.id, connection.tenantId);
    const live = this.sessions.get(connection.id);
    if (live) {
      await live.socket.logout().catch(() => undefined);
      await live.clearAuth();
      this.stopLocal(connection.id);
    } else {
      const auth = await this.authStore.createState(connection.id);
      await auth.clear();
    }
    await this.prisma.qrSessionLease.deleteMany({where:{connectionId:connection.id}});
    await this.prisma.qrPhoneClaim.deleteMany({where:{connectionId:connection.id}});
    await this.prisma.qrContactWindow.deleteMany({where:{connectionId:connection.id}});
  }
}
