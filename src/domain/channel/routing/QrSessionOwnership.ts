import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { SecretBox } from '../../../core/security/SecretBox';
export class QrSessionOwnership {
  private readonly owner=randomUUID();
  constructor(private readonly db:PrismaClient,private readonly box:SecretBox){}
  async claim(id:string){return Boolean((await this.db.$queryRaw<any[]>`INSERT INTO "QrSessionLease"("connectionId",owner,"expiresAt")
    VALUES (${id},${this.owner},NOW()+INTERVAL '90 seconds') ON CONFLICT("connectionId") DO UPDATE SET owner=EXCLUDED.owner,
    "expiresAt"=EXCLUDED."expiresAt","encryptedQr"=NULL,"qrExpiresAt"=NULL WHERE "QrSessionLease"."expiresAt"<NOW() RETURNING owner`).length);}
  async owns(id:string){return Boolean((await this.db.$queryRaw<any[]>`SELECT owner FROM "QrSessionLease" WHERE "connectionId"=${id}
    AND owner=${this.owner} AND "expiresAt">NOW()`).length);}
  async renew(id:string){return Boolean(await this.db.$executeRaw`UPDATE "QrSessionLease" SET "expiresAt"=NOW()+INTERVAL '90 seconds'
    WHERE "connectionId"=${id} AND owner=${this.owner} AND "expiresAt">NOW()`);}
  async release(id:string){await this.db.qrSessionLease.deleteMany({where:{connectionId:id,owner:this.owner}});}
  async saveQr(id:string,dataUrl:string|null){await this.db.qrSessionLease.updateMany({where:{connectionId:id,owner:this.owner,expiresAt:{gt:new Date()}},
    data:{encryptedQr:dataUrl?this.box.encrypt(dataUrl):null,qrExpiresAt:dataUrl?new Date(Date.now()+60000):null}});}
  async getQr(id:string){const row=await this.db.qrSessionLease.findUnique({where:{connectionId:id}});
    return row?.encryptedQr&&row.qrExpiresAt&&row.qrExpiresAt>new Date()&&row.expiresAt>new Date()
      ?{dataUrl:this.box.decrypt(row.encryptedQr),expiresAt:row.qrExpiresAt.getTime()}:null;}
}
