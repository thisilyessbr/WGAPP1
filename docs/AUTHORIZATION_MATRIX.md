# Relayqo Authorization Matrix & RBAC Specification

## Overview

Relayqo enforces strict multi-tenant isolation and role-based access control (RBAC) across all API endpoints, background workers, and webhooks.

This document details the identity model, role hierarchy, resource permissions, and enforcement mechanisms across the Relayqo platform.

---

## 1. Identity & Role Hierarchy

```
       +-------------------------------------------------------+
       |                  Platform Administrator               |
       |  (Operator / Infra: DEV_API_KEY / Platform Admin API) |
       +-------------------------------------------------------+
                                  |
                                  v
       +-------------------------------------------------------+
       |               Merchant / Tenant Admin                 |
       |     (Business Owner / Operator: Signed Bearer Token)  |
       +-------------------------------------------------------+
                                  |
                                  v
       +-------------------------------------------------------+
       |                  Customer / End-User                  |
       |      (WhatsApp User / Web Chat: Customer Token)       |
       +-------------------------------------------------------+
                                  |
       +-------------------------------------------------------+
       |                System & Background Tasks              |
       | (Meta Webhooks, Ingestion Workers, Internal Services) |
       +-------------------------------------------------------+
```

### Role Definitions

| Role | Principal Identifier | Authentication Mechanism | Scope & Purpose |
| :--- | :--- | :--- | :--- |
| **Platform Administrator** (`PLATFORM_ADMIN`) | `id: 'platform-api-key'`, `platformAdmin: true` | `x-api-key: <DEV_API_KEY>` or `Authorization: Bearer <DEV_API_KEY>` | Global cross-tenant access. Tenant creation, system health, platform metrics, and plan configuration. |
| **Merchant Admin** (`TENANT_ADMIN`) | `tenantId: <id>`, `role: 'admin'` | Signed HMAC-SHA256 Bearer Token or Portal Session Cookie | Full read/write management over the specific tenant and its accounts (catalogs, knowledge, channels, CRM). Cannot access other tenants. |
| **Merchant Client** (`PORTAL_CLIENT`) | `userId: <id>`, `accountId: <id>`, `tenantId: <id>` | Portal Session Cookie (`relayqo_portal`) | Portal access to specific merchant account workspace. Can edit business facts, draft products, view leads, and configure WhatsApp. |
| **Customer / End-User** (`CUSTOMER`) | `tenantId: <id>`, `customerId: <id>` | Signed Customer Token (`customerId` bound) or WhatsApp Sender Phone | Restricted strictly to the conversational chat endpoint (`POST /chat`) for the specific tenant. All mutation and administrative routes are forbidden. |
| **WhatsApp Ingestion** (`SYSTEM_WEBHOOK`) | Verified Meta App Signature | `X-Hub-Signature-256` HMAC-SHA256 signature using `WHATSAPP_APP_SECRET` | Receives inbound WhatsApp webhook payloads. Authenticated cryptographically per Meta Cloud API specification. |
| **Internal Services** (`SERVICE_INTERNAL`) | `sub: 'internal-service'` | `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` | Inter-service calls (e.g. image capability analysis microservice, telemetry ingestion). |

---

## 2. Resource Authorization Matrix

### Legend
- **ALLOW**: Permitted
- **SCOPE**: Permitted only within the authenticated tenant / account scope
- **DENY**: Forbidden (HTTP 403 Forbidden or HTTP 401 Unauthorized)
- **N/A**: Not mounted or disabled in production (HTTP 404 Not Found)

| Resource / Endpoint | Method | Unauth | Customer | Merchant Admin / Client | Platform Admin | System / Webhook | Enforcement Layer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **System & Health** | | | | | | | |
| `/health` | GET | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public unauthenticated health probe |
| `/api/health` | GET | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public unauthenticated API health probe |
| **Tenant Management** | | | | | | | |
| `/api/v1/tenants` | GET | DENY (401) | DENY (403) | DENY (403) | ALLOW | DENY (403) | `requirePlatformAdmin` |
| `/api/v1/tenants` | POST | DENY (401) | DENY (403) | DENY (403) | ALLOW | DENY (403) | `requirePlatformAdmin` |
| `/api/v1/bootstrap` | POST | N/A (404) | N/A (404) | N/A (404) | N/A (404) | N/A (404) | Gated in production (`NODE_ENV !== 'production'`) |
| **Business & Account Config** | | | | | | | |
| `/api/v1/config` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant-scoped check |
| `/api/v1/config` | POST/PUT | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant-scoped check |
| `/api/v1/accounts` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant-scoped check |
| `/api/v1/accounts` | POST | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant-scoped check |
| **Knowledge & RAG** | | | | | | | |
| `/api/v1/upload` | POST | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| `/api/v1/documents` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant-scoped check |
| `/api/v1/documents/:sourceId` | DELETE | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| **Ecommerce & Products** | | | | | | | |
| `/api/v1/products` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant-scoped check |
| `/api/v1/products` | POST | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| `/api/v1/products/:id` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant & Account scope |
| `/api/v1/products/:id` | PATCH | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| `/api/v1/products/:id` | DELETE | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| `/api/v1/products/:id/variants` | POST | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| `/api/v1/products/:id/variants/:variantId` | PATCH/DEL | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| **CRM & Leads** | | | | | | | |
| `/api/v1/crm/leads` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant & Account scope |
| `/api/v1/crm/leads/:id` | GET | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | Tenant & Account scope |
| `/api/v1/crm/leads/:id` | PATCH | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `isMutation` + Tenant & Account scope |
| **Chat & Customer Interaction** | | | | | | | |
| `/api/v1/chat` | POST | DENY (401) | SCOPE | SCOPE | ALLOW | DENY (403) | Token-bound tenant & customer check |
| `/api/v1/reset` | POST | N/A (404) | N/A (404) | N/A (404) | N/A (404) | N/A (404) | Gated in production |
| `/api/v1/pilot-harness/*` | ALL | N/A (404) | N/A (404) | N/A (404) | N/A (404) | N/A (404) | Gated in production |
| **WhatsApp Channels & Webhooks** | | | | | | | |
| `/api/v1/webhook/whatsapp` | GET | ALLOW (Verify) | DENY (403) | DENY (403) | DENY (403) | ALLOW | Meta verify token check |
| `/api/v1/webhook/whatsapp` | POST | DENY (401) | DENY (403) | DENY (403) | DENY (403) | ALLOW | HMAC-SHA256 signature verification |
| `/api/v1/whatsapp/embedded-signup/*` | ALL | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | State token HMAC validation |
| `/api/v1/channels/*` | ALL | DENY (401) | DENY (403) | SCOPE | ALLOW | DENY (403) | `requireAuth` + `requireAdmin` |
| **Legacy & Dev Endpoints** | | | | | | | |
| `/api/dev/*` | ALL | N/A (404) | N/A (404) | N/A (404) | N/A (404) | N/A (404) | Completely disabled in production |

---

## 3. Enforcement Mechanisms & Guarantees

### 1. Fail-Closed Authentication
- If no credentials or signature headers are provided on protected routes, execution immediately halts with HTTP 401 Unauthorized.
- Development header fallbacks (`x-tenant-id` without credentials) are strictly disabled when `NODE_ENV === 'production'`.
- Static strings (e.g. `test-hmac-auth-secret-key-32chars!`) are rejected in production. Startup is aborted if `AUTH_SECRET` is missing or shorter than 32 characters.

### 2. Multi-Tenant Scope Protection (Anti-IDOR)
- When a signed token is presented, `principal.tenantId` is immutable.
- Any attempt by a caller to supply `x-tenant-id`, query params, or body payloads requesting another tenant's data results in an immediate HTTP 403 Forbidden:
  ```json
  {
    "error": "FORBIDDEN",
    "message": "Tenant authorization mismatch: Authenticated principal (tenant-a) cannot access target tenant (tenant-b)."
  }
  ```

### 3. Customer Credential Restriction
- Tokens issued to customers (`principal.customerId != null`) are restricted exclusively to `POST /chat`.
- Any call by a customer to upload documents, modify products, list leads, or inspect configs is rejected with HTTP 403 Forbidden.

### 4. Route Isolation in Production
- Experimental harnesses (`/pilot-harness/*`), dev tenant bootstrap (`/bootstrap`), and legacy dev aliases (`/api/dev/*`) are unmounted in production and return HTTP 404 Not Found.
