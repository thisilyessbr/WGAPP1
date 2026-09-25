import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { SecretBox } from '../../../core/security/SecretBox';
import { WhatsAppNumberService } from './WhatsAppNumberService';

export interface ClientOwnedMetaCredentials {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export interface ClientOwnedMetaInput {
  appId: string;
  appSecret: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}

const numericId = (value: string) => /^\d{5,30}$/.test(value);

export class ClientOwnedMetaService {
  private readonly secretBox: SecretBox;
  private readonly numberService: WhatsAppNumberService;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly db: PrismaClient, options: { secretBox?: SecretBox; fetchFn?: typeof fetch } = {}) {
    this.secretBox = options.secretBox || new SecretBox();
    this.numberService = new WhatsAppNumberService(db);
    this.fetchFn = options.fetchFn || fetch;
  }

  private async graph(path: string, accessToken: string) {
    let response: Response;
    try {
      response = await this.fetchFn(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0'}/${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new Error('META_UNAVAILABLE');
    }
    if (!response.ok) throw new Error('META_CREDENTIALS_OR_ACCESS_INVALID');
    try { return await response.json() as any; } catch { throw new Error('META_INVALID_RESPONSE'); }
  }

  async prepare(accountId: string, input: ClientOwnedMetaInput) {
    for (const key of ['appId', 'wabaId', 'phoneNumberId'] as const) {
      if (!numericId(input[key])) throw new Error(`INVALID_${key.toUpperCase()}`);
    }
    if (!input.appSecret || input.appSecret.length > 256 || !input.accessToken || input.accessToken.length > 4096) {
      throw new Error('INVALID_META_CREDENTIALS');
    }
    const account = await this.db.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');

    // Meta's app-level webhook callback is singular. Do not overwrite another
    // account's callback or silently split one app across separate WABAs.
    const appConnections = await this.db.channelConnection.findMany({
      where: { appId: input.appId, provider: 'META_CLOUD' },
      select: { accountId: true, wabaId: true, connectionKey: true }
    });
    if (appConnections.some(connection => !connection.connectionKey.startsWith('CLIENT_OWNED:')
      || connection.accountId !== accountId || connection.wabaId !== input.wabaId)) {
      throw new Error('META_APP_ALREADY_ASSIGNED');
    }

    const existingNumber = await this.db.whatsAppBusinessNumber.findUnique({ where: { phoneNumberId: input.phoneNumberId } });
    if (existingNumber && existingNumber.accountId !== accountId) throw new Error('NUMBER_ALREADY_ASSIGNED');
    if (existingNumber?.connectionId) {
      const ownerConnection = await this.db.channelConnection.findUnique({ where: { id: existingNumber.connectionId } });
      if (ownerConnection && ownerConnection.connectionKey !== `CLIENT_OWNED:${input.appId}:${input.wabaId}`) {
        throw new Error('NUMBER_ALREADY_ASSIGNED');
      }
    }

    const debug = await this.graph(`debug_token?input_token=${encodeURIComponent(input.accessToken)}`, `${input.appId}|${input.appSecret}`);
    const token = debug?.data;
    if (token?.is_valid !== true || String(token.app_id) !== input.appId
      || !Array.isArray(token.scopes) || !token.scopes.includes('whatsapp_business_management')
      || !token.scopes.includes('whatsapp_business_messaging')) throw new Error('META_TOKEN_APP_OR_PERMISSIONS_INVALID');

    const numbers = await this.graph(`${input.wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`, input.accessToken);
    const number = Array.isArray(numbers?.data) ? numbers.data.find((row: any) => String(row.id) === input.phoneNumberId) : null;
    if (!number) throw new Error('NUMBER_NOT_IN_WABA');

    const siblings = await this.db.channelConnection.findMany({
      where: { accountId, tenantId: account.tenantId, provider: 'META_CLOUD', connectionKey: `CLIENT_OWNED:${input.appId}:${input.wabaId}` }
    });
    const sibling = siblings[0];
    const verifyToken = sibling?.encryptedCredentials
      ? this.secretBox.decryptJson<ClientOwnedMetaCredentials>(sibling.encryptedCredentials).verifyToken
      : randomBytes(32).toString('base64url');
    const credentials: ClientOwnedMetaCredentials = { accessToken: input.accessToken, appSecret: input.appSecret, verifyToken };
    const connection = await this.numberService.createOrUpdateConnection({
      tenantId: account.tenantId, accountId, provider: 'META_CLOUD',
      connectionKey: `CLIENT_OWNED:${input.appId}:${input.wabaId}`,
      status: sibling?.status === 'CONNECTED' ? 'CONNECTED' : sibling?.status === 'WEBHOOK_VERIFIED' ? 'WEBHOOK_VERIFIED' : 'PENDING',
      enabled: sibling?.status === 'CONNECTED' ? sibling.enabled : false,
      appId: input.appId, wabaId: input.wabaId,
      encryptedCredentials: this.secretBox.encryptJson(credentials)
    });
    await this.numberService.registerNumber({
      tenantId: account.tenantId, accountId, connectionId: connection.id,
      phoneNumberId: input.phoneNumberId, wabaId: input.wabaId,
      displayPhoneNumber: String(number.display_phone_number || ''),
      status: existingNumber?.enabled && existingNumber.connectionId === connection.id ? existingNumber.status : 'PENDING',
      enabled: Boolean(existingNumber?.enabled && existingNumber.connectionId === connection.id)
    });
    return this.setup(connection.id, accountId);
  }

  async setup(connectionId: string, accountId: string) {
    const connection = await this.db.channelConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.accountId !== accountId || !connection.connectionKey.startsWith('CLIENT_OWNED:') || !connection.encryptedCredentials) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    const { verifyToken } = this.secretBox.decryptJson<ClientOwnedMetaCredentials>(connection.encryptedCredentials);
    if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_PUBLIC_URL) throw new Error('PORTAL_PUBLIC_URL_REQUIRED');
    const publicUrl = new URL(process.env.PORTAL_PUBLIC_URL || 'http://localhost:3000');
    if (process.env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') throw new Error('PORTAL_PUBLIC_URL_REQUIRES_HTTPS');
    return {
      connectionId, status: connection.status, verifyToken,
      callbackUrl: `${publicUrl.origin}/api/webhook/whatsapp/client/${connectionId}`,
      appId: connection.appId, wabaId: connection.wabaId
    };
  }

  async activate(connectionId: string, accountId: string) {
    const connection = await this.db.channelConnection.findUnique({ where: { id: connectionId }, include: { numbers: true } });
    if (!connection || connection.accountId !== accountId || !connection.connectionKey.startsWith('CLIENT_OWNED:')
      || !['WEBHOOK_VERIFIED', 'CONNECTED'].includes(connection.status) || !connection.wabaId || !connection.encryptedCredentials || !connection.numbers.length) {
      throw new Error('WEBHOOK_NOT_VERIFIED');
    }
    const { accessToken } = this.secretBox.decryptJson<ClientOwnedMetaCredentials>(connection.encryptedCredentials);
    let response: Response;
    try {
      response = await this.fetchFn(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0'}/${connection.wabaId}/subscribed_apps`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new Error('META_SUBSCRIPTION_FAILED');
    }
    if (!response.ok || (await response.json() as any)?.success !== true) throw new Error('META_SUBSCRIPTION_FAILED');
    await this.db.$transaction(async tx => {
      await tx.channelConnection.update({ where: { id: connectionId }, data: { status: 'CONNECTED', enabled: true, lastConnectedAt: new Date() } });
      await tx.whatsAppBusinessNumber.updateMany({
        where: { connectionId, tenantId: connection.tenantId, accountId }, data: { status: 'CONNECTED', enabled: true }
      });
    });
    return { connectionId, status: 'CONNECTED', numbers: connection.numbers.map(n => n.displayPhoneNumber || n.phoneNumberId) };
  }
}
