import { PrismaClient, ChannelConnection } from '@prisma/client';
import type { WASocket } from '@whiskeysockets/baileys' with { "resolution-mode": "import" };
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import { MessageQueue, InboundQueueJob } from '../whatsapp/MessageQueue';
import { WhatsAppNumberService } from '../whatsapp/WhatsAppNumberService';
import { SecretBox } from '../../../core/security/SecretBox';
import { PrismaBaileysAuthStore } from './PrismaBaileysAuthStore';
import { logger } from '../../../utils/logger';

interface LiveQrSession {
  socket: WASocket;
  qrDataUrl: string | null;
  qrExpiresAt: number | null;
  clearAuth: () => Promise<void>;
}

export class QrSessionManager {
  private readonly sessions = new Map<string, LiveQrSession>();
  private readonly authStore: PrismaBaileysAuthStore;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly numberService: WhatsAppNumberService,
    private readonly queue: MessageQueue<InboundQueueJob>,
    secretBox: SecretBox,
    enabled = process.env.ENABLE_QR_CHANNELS === 'true'
  ) {
    this.authStore = new PrismaBaileysAuthStore(prisma, secretBox);
    this.enabled = enabled;
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
    await this.start(connection.id);
    return { connection, phoneNumberId };
  }

  async start(connectionId: string): Promise<void> {
    if (!this.enabled || this.sessions.has(connectionId)) return;
    if (await this.numberService.isEmergencyQrStopped()) return;

    const connection = await this.prisma.channelConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.provider !== 'QR_WEB' || !connection.enabled) return;

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

    socket.ev.on('creds.update', auth.saveCreds);
    socket.ev.on('connection.update', async update => {
      try {
        if (update.qr) {
          live.qrDataUrl = await QRCode.toDataURL(update.qr, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
          live.qrExpiresAt = Date.now() + 60_000;
          await this.numberService.updateConnectionStatus(connection.id, connection.tenantId, 'QR_REQUIRED');
        }

        if (update.connection === 'open') {
          live.qrDataUrl = null;
          live.qrExpiresAt = null;
          const ownJid = socket.user?.id || '';
          const display = ownJid.split(':')[0].split('@')[0] || 'QR connected';
          await this.numberService.updateConnectionStatus(connection.id, connection.tenantId, 'CONNECTED');
          await this.prisma.whatsAppBusinessNumber.updateMany({
            where: { connectionId: connection.id, tenantId: connection.tenantId },
            data: { status: 'CONNECTED', enabled: true, displayPhoneNumber: display }
          });
        }

        if (update.connection === 'close') {
          this.sessions.delete(connection.id);
          const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
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
            setTimeout(() => void this.start(connection.id), 5_000);
          }
        }
      } catch (error: any) {
        logger.error(`QrSessionManager: connection state update failed for [${connection.id}]: ${error.message || error}`);
      }
    });

    socket.ev.on('messages.upsert', async event => {
      for (const message of event.messages) {
        try {
          if (message.key.fromMe || !message.key.remoteJid || message.key.remoteJid.endsWith('@g.us') || message.key.remoteJid === 'status@broadcast') continue;
          const content = message.message;
          const text = content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || '';
          if (!text.trim() || !message.key.id) continue;
          const mapping = await this.prisma.whatsAppBusinessNumber.findFirst({ where: { connectionId: connection.id, enabled: true } });
          if (!mapping) continue;
          const waId = message.key.remoteJid.split('@')[0];
          const rawTimestamp = Number(message.messageTimestamp || Date.now());
          const timestamp = rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
          const partitionKey = `${connection.tenantId}:${connection.accountId}:${waId}`;
          await this.queue.enqueue({
            id: message.key.id,
            partitionKey,
            tenantId: connection.tenantId,
            accountId: connection.accountId,
            phoneNumberId: mapping.phoneNumberId,
            waId,
            wamid: message.key.id,
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
  }

  async restoreEnabledSessions(): Promise<void> {
    if (!this.enabled) return;
    const connections = await this.prisma.channelConnection.findMany({
      where: { provider: 'QR_WEB', enabled: true, status: { in: ['CONNECTED', 'RECONNECTING', 'QR_REQUIRED', 'PENDING'] } }
    });
    for (const connection of connections) {
      await this.start(connection.id);
    }
  }

  async suspendAll(): Promise<void> {
    for (const [connectionId, live] of this.sessions) {
      live.socket.end(new Error('Emergency QR stop'));
      this.sessions.delete(connectionId);
    }
    await this.prisma.whatsAppBusinessNumber.updateMany({
      where: { transport: 'QR_WEB' },
      data: { enabled: false, status: 'EMERGENCY_STOPPED' }
    });
  }

  getQr(connectionId: string): { dataUrl: string; expiresAt: number } | null {
    const live = this.sessions.get(connectionId);
    if (!live?.qrDataUrl || !live.qrExpiresAt || live.qrExpiresAt <= Date.now()) return null;
    return { dataUrl: live.qrDataUrl, expiresAt: live.qrExpiresAt };
  }

  async send(connectionId: string, recipient: string, text: string): Promise<{ id: string | null }> {
    if (!this.enabled || await this.numberService.isEmergencyQrStopped()) {
      throw new Error('QR delivery is disabled by feature flag or emergency stop');
    }
    const live = this.sessions.get(connectionId);
    if (!live) throw new Error('QR session is not active on this worker');
    const jid = recipient.includes('@') ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
    const result = await live.socket.sendMessage(jid, { text });
    return { id: result?.key?.id || null };
  }

  async disconnect(connection: ChannelConnection): Promise<void> {
    const live = this.sessions.get(connection.id);
    if (live) {
      await live.socket.logout().catch(() => undefined);
      await live.clearAuth();
      this.sessions.delete(connection.id);
    } else {
      const auth = await this.authStore.createState(connection.id);
      await auth.clear();
    }
    await this.numberService.disconnectConnection(connection.id, connection.tenantId);
  }
}
