# Project audit fixes — 28 September 2026

## Changes

- Exclude isolated admin preview conversations by Customer.externalId, rather than comparing a customer UUID with the preview prefix. Apply this to client/admin metrics, conversation lists, leads and exports.
- Preserve closed customer requests. Reuse an open request and attach its completed workflow once; create another request for a separate completed workflow. Lock the scoped customer while creating requests to serialize competing writes.
- Associate order details and CSV rows with the request's actual completed workflow. Cancelled COD sessions cannot supply order details. Backfill only historical completed-sales requests with exactly one eligible session; leave ambiguous records for review.
- Hide request navigation and reject client request APIs when the assigned plan includes neither services nor commerce.
- Add authenticated, account-scoped product photo uploads and variant photos. Re-encode permitted photos as JPEG, strip metadata, limit dimensions, deduplicate per account and enforce combined document/photo storage limits. Only published photos are publicly readable. Frozen editing and product locks apply to uploads and removals; retained publication history protects referenced photos.
- Honor CORS_ORIGINS with credentialed requests. Unknown browser origins receive no CORS permission; server-to-server callers continue working.
- Select Deepgram multilingual transcription for a known English/French conversation, retaining Arabic/Moroccan Arabic transcription for Arabic/Darija context. Scope language hints and billing to the account. Charge the selected model's rate without an additional transcription retry.
- Prevent generic fabric descriptions from qualifying as evidence for an unrelated product attribute, such as waterproofing.
- Repair Arabic sales dashboard labels and verify RTL/mobile layouts. Update stale test fixtures and expectations to current conversation, preview and signup contracts.

## Verification

- Production build: passed.
- Available regression suite: 1,232 tests passed across 95 files, zero failures.
- Browser suite: two tests passed, covering signup, admin controls, photo uploads, multilingual layouts and WhatsApp fallback.
- Additional migration regression: four focused database tests passed, including conservative historical backfill.
- Schema validation and whitespace checks: passed.

The available regression suite is not the entire repository suite. Other integration suites require a separate TEST_DATABASE_URL, which was not configured. Tests did not use the production database. Live Meta delivery, production migration execution and real voice-note accuracy were not retested by this change. Language hints improve routing but do not guarantee accurate Darija transcription or identify a language switch from audio alone.

## Release and rollback

Apply both migrations before starting the new runtime. The Docker startup and Render pre-deploy configuration already run prisma migrate deploy. Confirm this in the actual service before release, take a database backup and verify request history, upload access and live messaging after release.

The photo table is additive. The repeat-request migration removes the former unique customer/request constraint. An older CRM runtime relying on that constraint cannot safely be restored after multiple requests exist for a customer. Prefer a forward correction; restoring the older CRM requires a reviewed data/constraint compatibility procedure. Do not automatically delete request history to make rollback possible.

This branch has not been deployed by the audit task.
