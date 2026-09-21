# Relayqo admin and client portals

Implemented in the existing backend. The portals are feature-gated and have **not been deployed or enabled against the existing database**. No live WhatsApp signup, email delivery or paid AI request was made during verification.

## What is available

| Area | Client | Administrator |
| --- | --- | --- |
| Account | Register, verify email, log in, recover password, log out | Email-confirmed login; disable or restore client access |
| Business data | Business details, policies, FAQs, products, variants and services; autosave | Review and edit client data; lock selected fields |
| Plans | View public offers and request a plan | Create/edit offers, assign versioned plans, customize an individual account's limits |
| Chatbot | View setup/activation status | Configure model, tone, language, output limits, prompts, intents, workflows and retrieval |
| Knowledge | Upload/download own PDFs and remove unpublished documents | Download for review, approve indexing, remove documents |
| WhatsApp | Scoped Meta signup/reconnection; optional QR linking when enabled and included | Review connections, enable/pause connections, activate/suspend chatbot |
| Publication | Submit setup and see the review note | Publish, optionally auto-publish validated updates, restore prior business data |
| Visibility | Own business workspace only | Managed client accounts, conversations, leads, response sources, language/script usage, latency, delivery/retry status, token operations and estimated spend |

Client routes never accept model settings, credentials, activation changes or plan entitlements. Administrators operate in their own authenticated session and actions record the real actor. Restoring data preserves current administrative configuration and suspension.

## Entry points and website integration

- `/signup`, `/login`, `/forgot-password`, `/verify-email`, `/reset-password`, `/admin-confirm`
- `/app`: client workspace
- `/admin`: administrator workspace
- `/api/portal/plans`: public, sanitized offers; no internal pricing assumptions or technical templates

The public marketing site's source was not present in this workspace. Its deployment was not modified. Add “Create account” and “Log in” links pointing to the portal origin's `/signup` and `/login`. The existing site's pricing section can read `/api/portal/plans`, or link to signup. If the site and portal share a domain through a reverse proxy, forward the entry paths above, `/app/*`, `/admin/*`, `/portal-assets/*`, `/api/auth/*`, `/api/client/*`, `/api/admin/*` and `/api/portal/*` to this backend. Keep the portal and its APIs on the same origin.

No real commercial offers were invented. Create your actual plan names, prices, modules and allowances in `/admin/plans`. Updating a shared plan does not silently replace assigned snapshots. Reassign the plan or explicitly select “Apply the latest version” to update an existing account. Account-specific limits keep existing usage counters.

## Production setup

1. Back up the database and inspect migration history with `npx prisma migrate status`. The new migration is additive: `20260913180000_add_client_admin_portals`. The test database successfully applied the complete repository migration chain. If the existing database was previously managed with `db push`, reconcile its migration history before deployment; do not reset it.
2. Apply approved migrations with `npx prisma migrate deploy` and build with `npm run build`.
3. Configure `PORTAL_PUBLIC_URL` as the actual HTTPS portal origin. Add this origin to `CORS_ORIGINS`. Configure the reverse proxy as assumed by the existing one-hop proxy setting. Do not expose the backend directly as an unrestricted alternative to that proxy.
4. Configure the email webhook described below. Production disables development email links regardless of `PORTAL_DEV_AUTH_LINKS`.
5. Create the first administrator using `npm run portal:admin`. It prompts for name/email and a hidden password. It never overwrites or promotes an existing user. Another administrator requires an explicit `--additional` argument. For automation, inject `PORTAL_ADMIN_EMAIL`, `PORTAL_ADMIN_NAME` and `PORTAL_ADMIN_PASSWORD` through the deployment's secret mechanism. Do not paste passwords into shell history.
6. Configure the existing Meta app, signup configuration, callback domain, webhook, encryption key and signup-state secret. Use the standard WhatsApp business-number signup flow and complete Meta's provider/app approval requirements. The browser collects the OAuth code and business/number IDs, then submits them through a scoped, expiring, one-use server attempt. App secrets and access tokens remain on the server. Coexistence/WABA-only flows which do not return a phone number are not implemented by this portal.
7. Set `PORTAL_DOCUMENT_WORKER=true` on a backend worker sharing the database and embedding credentials. The durable queue only indexes administrator-approved PDFs. QR linking additionally requires the existing dedicated QR worker with `ENABLE_QR_CHANNELS=true` and a plan including `qr`; it must use the existing session ownership/deployment arrangement.
8. Set `PORTAL_ENABLED=true` and restart. Publish your offers, then verify a staging client through submission, plan assignment, data publication, WhatsApp connection and activation.

For local development only, use `PORTAL_PUBLIC_URL=http://localhost:3000` and `PORTAL_DEV_AUTH_LINKS=true` with the feature flag enabled. This shows test verification links on screen. Keep it off on publicly accessible development instances.

Existing accounts remain on their prior runtime path until explicitly migrated into portal profiles/memberships. The administration lists portal-managed accounts. Existing customer ownership must be mapped before importing legacy accounts; no automatic reassignment of existing client data was performed.

## Email delivery contract

Set `PORTAL_MAIL_WEBHOOK_URL` to an HTTPS mail-delivery endpoint and `PORTAL_MAIL_WEBHOOK_SECRET` to a strong shared secret. Relayqo posts JSON:

```json
{"to":"client@example.com","template":"VERIFY","actionUrl":"https://portal.example.com/verify-email#token=..."}
```

Templates are `VERIFY`, `RESET` and `ADMIN_LOGIN`. The receiver must verify `X-Relayqo-Timestamp` and `X-Relayqo-Signature`: HMAC-SHA256 over `timestamp + "." + exactRequestBody`, using the shared secret. Reject stale/replayed messages and use constant-time signature comparison. Deliver the link to `to`, return a successful status only when accepted for delivery, and redact action URLs from logs. Verification/reset links contain bearer secrets. The sender has an eight-second timeout and does not follow redirects.

Email delivery remains an integration point for your chosen mail provider; no external provider account was created or configured.

## Cost and data safeguards

- Durable monthly usage buckets and reservations run inside PostgreSQL transactions. Allowances cover incoming messages, AI operations, embeddings, images, WhatsApp numbers, catalog size, documents, storage and estimated USD spend. Concurrent requests cannot each reuse the same remaining reservation.
- Activation and allowance checks run before managed chatbot work. Unpublished/inactive accounts cannot use the chatbot; clients cannot grant themselves a paid plan. Disabling the portal flag also blocks managed runtime configuration instead of removing its spending controls.
- LLM reservations include conservative input/output and retry estimates, with up to four helper calls per turn. Only priced DeepSeek models or the mock provider are allowed. Changing model pricing requires updating the rate assumptions in `PortalBudget.ts`.
- Provider token receipts settle reservations where available. Unknown outcomes retain their estimate. Actual measured charges are recorded even if larger than the original reservation; estimates are not a guarantee of an external provider invoice.
- Image estimates reserve $1 per request; embedding estimates use conservative byte counts. WhatsApp fees, hosting, taxes, payment fees and revenue are not included. Payment collection, invoices and subscription renewal automation are not implemented; administrators assign plans and activation manually.
- The month uses UTC. Operational statistics use a bounded recent window; counters are not labeled as resolved sales or revenue. Browser previews consume the account allowance but do not send WhatsApp messages. The preview uses the published active configuration.
- PDF bodies are stored within account quotas; repeated identical uploads reuse the stored document. Removed catalog entries are retired, preserving historical references. Data stays in a draft until publication. Business-owner facts enter bounded evidence, not the trusted instruction text; long policies are excerpts and should also be uploaded as reviewed PDFs for detailed retrieval.
- Cookie sessions are HttpOnly, SameSite=Lax and Secure over HTTPS, with CSRF/origin checks and server-side revocation. Passwords use scrypt. Signup/login/reset have durable rate limits. Public signup always creates the CLIENT role.
- Migration/schema and Prisma Client/CLI now agree. The configuration dependency is pinned to patched `deepmerge-ts` 8.0.0; the [maintainer advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) identifies the corrected recursive-merge issue. Dependency audit after installation reported zero known vulnerabilities.

## Verification

Evidence is saved under `output/portal-verification/`:

- `regression-results.json`: selected database-independent chatbot, Darija, cost and configuration suites, LLM integration checks, and portal PostgreSQL/API tests.
- `browser-results.json`: full client/admin browser flow using isolated local PostgreSQL and mocked WhatsApp/preview responses.
- `admin-desktop.png`, `client-desktop.png`, `client-mobile.png`: inspected screenshots.
- `npm run build` and `prisma validate` passed.

Portal API checks cover role escalation, email confirmation, single-use links, session revocation, CSRF, cross-account access, locked fields, stale saves, catalog publication/variants, restoration, activation gates, concurrent quotas, provider cost settlement, client-specific limits, PDF approval and scoped WhatsApp callbacks. Browser checks cover signup → verification → login → catalog/variant/FAQ editing → reload persistence → submission → admin review/publication → mocked WhatsApp connection → activation → preview, plus client navigation separation and mobile overflow.

Tests use PGlite PostgreSQL with the real migration chain; vector storage is substituted in the test fixture because these checks do not exercise vector similarity. Paid providers, live Meta login, mail delivery, production traffic and multiple physical worker processes were not tested here. The browser preview response is mocked and is not a live Darija model evaluation; the existing Darija regression suite is tested separately.

## Rollback

Before rolling back a deployment with newly onboarded clients, suspend managed accounts and pause their connections. Stop portal/document workers. Preserve the additive database tables and client data; do not run a destructive down migration.

The source rollback package is `output/rollback/portal-fixes-20260913/`. Its script validates all current file hashes and original backups before changing anything:

```powershell
& ./output/rollback/portal-fixes-20260913/rollback.ps1
# Only after reviewing the verification:
& ./output/rollback/portal-fixes-20260913/rollback.ps1 -Apply
```

The rollback restores the pre-portal files while preserving the earlier chatbot/Darija/cost work. It refuses to overwrite edits made after the recorded checkpoint. If dependencies need restoring, run `npm ci` against the restored package lock. The previous repository's Prisma CLI/client mismatch predates these changes; the rollback script rebuilds using the installed compiler rather than attempting that older generator. Restart services only after checking the build and account/connection suspension. Source rollback does not roll back database contents, generated binaries, external settings or deployment state.
