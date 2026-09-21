# Relayqo Security Secret Rotation Runbook

## Executive Summary & Threat Model

During the pre-production security audit, several sensitive production credentials were discovered residing in uncommitted local environment configuration files (`.env` and `.env.production`).

An extensive Git commit log audit (`git log -S`) confirmed that **active production third-party credentials were never committed into Git history**. The only historical secret found was a static test authentication string (`test-hmac-auth-secret-key-32chars!`), which has now been completely eliminated from the codebase.

However, because these files resided on local workstations and unverified environments, all third-party secrets must be treated as exposed and manually rotated per standard incident response best practices.

---

## 1. Manual Third-Party Service Rotation Checklist

### A. Supabase / PostgreSQL Database
- **Impact**: Database connection strings contained plaintext credentials.
- **Rotation Steps**:
  1. Navigate to the [Supabase Dashboard](https://app.supabase.com/) -> Select the Relayqo Project.
  2. Go to **Project Settings** -> **Database**.
  3. Scroll down to **Database Password** and click **Reset Database Password**.
  4. Generate a cryptographically secure random password (minimum 32 characters with alphanumeric and special characters).
  5. Copy the updated Connection String for **Connection Pooling** (Transaction mode, port 6543) and **Direct Connection** (port 5432).
  6. Update `DATABASE_URL` and `DIRECT_URL` in the production deployment environment (e.g. Render / VPS environment manager).
  7. Deploy/Restart the application to establish connections with the new credential.

### B. Meta / WhatsApp Cloud API
- **Impact**: `WHATSAPP_APP_SECRET` / `META_APP_SECRET` authenticates webhooks from Meta and Embedded Signup callbacks.
- **Rotation Steps**:
  1. Log into the [Meta for Developers Console](https://developers.facebook.com/).
  2. Select the Relayqo Application.
  3. Go to **App Settings** -> **Basic**.
  4. Beside **App Secret**, click **Reset** (or generate a secondary secret if utilizing Meta dual-secret rotation).
  5. Generate a new high-entropy webhook verification token:
     ```bash
     node -e "console.log(crypto.randomBytes(32).toString('hex'))"
     ```
  6. Go to **WhatsApp** -> **Configuration** in the Meta App dashboard.
  7. Under **Webhook**, click **Edit**.
  8. Paste the new verification token into the **Verify Token** field.
  9. Update `META_APP_SECRET`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in the production environment variables.
  10. Restart the production backend service, then click **Verify and Save** in the Meta Developer Console.

### C. DeepSeek API Key
- **Impact**: API key used for Moroccan Darija conversational LLM queries.
- **Rotation Steps**:
  1. Access the [DeepSeek Platform Console](https://platform.deepseek.com/).
  2. Navigate to **API Keys**.
  3. Click **Create new API key** (name: `relayqo-production-YYYYMMDD`).
  4. Copy the new key and update `DEEPSEEK_API_KEY` in the production hosting environment.
  5. Restart the backend service.
  6. Verify successful completion of test queries, then delete/revoke the compromised API key in the DeepSeek console.

### D. Google Gemini API Key
- **Impact**: API key used for Gemini multimodal image analysis and embeddings.
- **Rotation Steps**:
  1. Go to [Google AI Studio](https://aistudio.google.com/) or [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
  2. Generate a new API key with restricted scope (Gemini API only).
  3. Update `GOOGLE_API_KEY` in production environment variables.
  4. Restart the backend service.
  5. Revoke/delete the previous API key.

---

## 2. Platform Symmetric Secret Generation

All internal secrets must have at least 32 bytes (256 bits) of entropy. Never use hardcoded strings or predictable timestamps.

Generate new secrets using the following commands:

```bash
# AUTH_SECRET (HMAC-SHA256 signing secret for administrative and tenant JWTs)
node -e "console.log(crypto.randomBytes(32).toString('hex'))"

# SIGNUP_STATE_SECRET (HMAC signing secret for Meta Embedded Signup OAuth state tokens)
node -e "console.log(crypto.randomBytes(32).toString('hex'))"

# INTERNAL_SERVICE_TOKEN (Bearer token for Image Capability and Telemetry microservices)
node -e "console.log(crypto.randomBytes(32).toString('hex'))"

# MONITORING_ADMIN_TOKEN (Admin Bearer token for traces and metrics)
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

---

## 3. Safe Dual-Key Migration Strategy for `ENCRYPTION_KEY`

> [!CAUTION]
> **DO NOT BLINDLY REPLACE `ENCRYPTION_KEY` IN PRODUCTION!**
> 
> WhatsApp business credentials (`ChannelConnection.encryptedCredentials`) and session secrets (`ChannelSessionSecret.encryptedValue`) are encrypted in the PostgreSQL database using AES-256-GCM via `SecretBox`. Blindly changing `ENCRYPTION_KEY` will render all existing tenant WhatsApp connections unreadable and permanently broken.

### Migration Architecture (Zero-Downtime Re-Encryption)

To rotate `ENCRYPTION_KEY` safely without breaking active channels:

#### Step 1: Deploy Dual-Key `SecretBox` Decryption
Configure the backend to support a primary key and an optional fallback key:
- `ENCRYPTION_KEY`: The new active key (used for all new encryptions).
- `ENCRYPTION_KEY_PREVIOUS`: The retired key (used as fallback for decrypting legacy records).

When decrypting:
1. Attempt decryption with `ENCRYPTION_KEY`.
2. If decryption fails and `ENCRYPTION_KEY_PREVIOUS` is configured, attempt decryption with `ENCRYPTION_KEY_PREVIOUS`.
3. If successful with the previous key, optionally mark the record for opportunistic re-encryption.

#### Step 2: Batch Re-Encryption Script (`scripts/reencrypt-database.ts`)
Execute an offline or online transactional migration script:
```ts
import { prisma } from '../src/tests/testDb';
import { SecretBox } from '../src/core/security/SecretBox';

async function migrateKeys(oldKey: string, newKey: string) {
  const oldBox = new SecretBox(oldKey);
  const newBox = new SecretBox(newKey);

  // 1. Re-encrypt ChannelConnection credentials
  const connections = await prisma.channelConnection.findMany({
    where: { encryptedCredentials: { not: null } }
  });

  for (const conn of connections) {
    if (!conn.encryptedCredentials) continue;
    const decrypted = oldBox.decrypt(conn.encryptedCredentials);
    const reencrypted = newBox.encrypt(decrypted);
    await prisma.channelConnection.update({
      where: { id: conn.id },
      data: { encryptedCredentials: reencrypted }
    });
  }

  // 2. Re-encrypt ChannelSessionSecret values
  const secrets = await prisma.channelSessionSecret.findMany();
  for (const sec of secrets) {
    const decrypted = oldBox.decrypt(sec.encryptedValue);
    const reencrypted = newBox.encrypt(decrypted);
    await prisma.channelSessionSecret.update({
      where: { id: sec.id },
      data: { encryptedValue: reencrypted }
    });
  }
}
```

#### Step 3: Deprecate Legacy Key
Once all rows in `ChannelConnection` and `ChannelSessionSecret` have been successfully re-encrypted and verified, unset `ENCRYPTION_KEY_PREVIOUS` from the production environment.
