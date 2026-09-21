import { PrismaClient } from '@prisma/client';
import type { AuthenticationState, SignalDataSet, SignalDataTypeMap } from '@whiskeysockets/baileys' with { "resolution-mode": "import" };
import { SecretBox } from '../../../core/security/SecretBox';

export class PrismaBaileysAuthStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secretBox: SecretBox
  ) {}

  async createState(connectionId: string): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    clear: () => Promise<void>;
  }> {
    const client = this.prisma as any;
    const { BufferJSON, initAuthCreds, proto } = await import('@whiskeysockets/baileys');
    const serialize = (value: unknown) => this.secretBox.encrypt(JSON.stringify(value, BufferJSON.replacer));
    const deserialize = <T>(value: string): T => JSON.parse(this.secretBox.decrypt(value), BufferJSON.reviver) as T;
    const savedCreds = await client.channelSessionSecret.findUnique({
      where: {
        connectionId_category_secretKey: {
          connectionId,
          category: 'creds',
          secretKey: 'main'
        }
      }
    });

    const creds = savedCreds
      ? deserialize<AuthenticationState['creds']>(savedCreds.encryptedValue)
      : initAuthCreds();

    const write = async (category: string, secretKey: string, value: unknown) => {
      await client.channelSessionSecret.upsert({
        where: { connectionId_category_secretKey: { connectionId, category, secretKey } },
        create: {
          connectionId,
          category,
          secretKey,
          encryptedValue: serialize(value)
        },
        update: { encryptedValue: serialize(value) }
      });
    };

    const remove = async (category: string, secretKey: string) => {
      await client.channelSessionSecret.deleteMany({ where: { connectionId, category, secretKey } });
    };

    const state: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const records = await client.channelSessionSecret.findMany({
            where: { connectionId, category: String(type), secretKey: { in: ids } }
          });
          const values: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const record of records) {
            let value: any = deserialize(record.encryptedValue);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            values[record.secretKey] = value;
          }
          return values;
        },
        set: async (data: SignalDataSet) => {
          for (const [category, entries] of Object.entries(data)) {
            if (!entries) continue;
            for (const [secretKey, value] of Object.entries(entries)) {
              if (value === null || value === undefined) {
                await remove(category, secretKey);
              } else {
                await write(category, secretKey, value);
              }
            }
          }
        }
      }
    };

    return {
      state,
      saveCreds: () => write('creds', 'main', creds),
      clear: () => client.channelSessionSecret.deleteMany({ where: { connectionId } })
    };
  }
}
