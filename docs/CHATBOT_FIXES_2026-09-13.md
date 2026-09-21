# Chatbot audit fixes — 13 September 2026

Implemented locally against the existing working tree. No deployment, database migration, production message or live AI request was performed. Original files were copied before editing, including pre-existing uncommitted changes.

## Changes addressing the 12 audit findings

| Audit finding | Implemented behavior |
| --- | --- |
| 1. Unsafe early FAQ shortcuts | FAQ paths, including post-workflow questions, now check the canonical intent, multiple policy requests, category, script and shipping scope. A Morocco shipping answer cannot answer a France shipping request. |
| 2. Negation ignored | English, French, Arabic and Darija negations block purchase and human-handoff triggers. CRM also rejects negated purchase signals. Positive requests remain supported. |
| 3. Substring intent collisions | Latin policy terms require word boundaries. `skincare`, `code` and `spaceship` no longer trigger CARE, COD payment or SHIPPING. Arabic clitic behavior is retained. |
| 4. Handoff response suppressed | The handoff state and acknowledgment are committed together. Only the acknowledgment linked to the initiating external message may pass the human-request guard; an actual operator takeover still blocks it. Later inbound messages are saved without automated replies. Default wording confirms that the request was recorded, without claiming an operator was notified. |
| 5. Temporary blocks dropped replies | Circuit-breaker and rate-limit restrictions are retryable. The durable queue schedules a retry after the restriction window, instead of exhausting retries every five seconds. Permanent safety restrictions remain blocked. |
| 6. Stale state overwrites | A version conflict rejects the stale commit. It no longer substitutes the latest version into an old decision. Local turns for one conversation execute in sequence; external-message replay links directly to its own assistant response. Silent turns replay silently. |
| 7. Fake embeddings and unbounded calls | Missing production embedding credentials now produce an explicit unavailable provider. Mock embeddings remain confined to test mode. Gemini embedding calls have an eight-second deadline and validate numeric vectors. |
| 8. Incorrect final workflow intent | Merely having workflows configured no longer marks unrelated replies as workflow execution. CRM and telemetry receive the actual response route. |
| 9. Purchase intent lost beside policy questions | Clause-level affirmative purchase requests are retained as a secondary intent, recorded in conversation context and passed to CRM. The response asks the customer to confirm the product after addressing the policy question. It does not place an order automatically. |
| 10. WhatsApp media silently ignored | Image jobs retain the media reference and caption, use number-scoped credentials to download the image, then enter the existing image capability. Downloads have deadlines, a 5 MiB size cap, an HTTPS Meta CDN allowlist and no redirects. Interactive selections become text. Audio, documents, video and other unsupported attachments receive a recorded request to resend as text. Reactions and stickers remain ignored. |
| 11. Unauthenticated supporting services | Image analysis and telemetry ingest require a backend service token. Trace reads require the monitoring admin token. Raw image-provider output is hidden outside test mode. Backend callers attach the service token. |
| 12. Automation-state read errors allow replies | Actual automation-state database failures propagate as `SAFETY_STATE_UNAVAILABLE`. They no longer mean “automation allowed.” Lightweight adapters without that optional store retain compatibility. |

Four stale UI endpoint assertions were updated to the current `/api/...` routes. The Arabizi handoff test now checks the truthful acknowledgment and script.

## Verification

- **540/540 tests passed across 44 database-independent unit files**, including **50 new regression tests** for these changes.
- **Type checking and TypeScript compilation passed.** Existing generated Prisma dependencies were used; no schema or dependency regeneration was performed.
- Additional integration checks: **48/57 passed both before and after the fixes**. All nine failures match the saved pre-fix source run: older mocks in `turn-decision-knowledge.spec.ts` and `final-boundary-quality-31b.spec.ts` lack `ConversationService.getMessageCount`. The comparison loads snapshots without restoring or modifying working files.
- No new failure names appeared in that integration comparison. Live PostgreSQL concurrency, actual Meta delivery and deployed AI/service credentials still require staging verification.

Evidence is in `output/chatbot-audit/final-unit-results.json`, `final-integration-results.json` and `baseline-integration-results.json`. The original audit evidence is preserved separately.

## Configuration required when enabling supporting services

- Set `INTERNAL_SERVICE_TOKEN` to the same random secret of at least 32 characters on the chatbot backend, image service and monitoring service. Keep it on trusted servers.
- Set `MONITORING_ADMIN_TOKEN` for administrative trace access. It is separate from the service token.
- Real document retrieval requires a valid `GOOGLE_API_KEY`. Image processing also requires an enabled account image capability and an available configured image service.
- `.env.example` documents these values. Existing customer-configured handoff prompts are preserved; review any custom text that promises an actual operator notification.

## Rollback

Backup directory: `output/rollback/chatbot-fixes-20260913-125553`.

From the project directory, run the following to verify backups without changing files:

```powershell
& './output/rollback/chatbot-fixes-20260913-125553/rollback.ps1'
```

To restore only this fix batch and rebuild:

```powershell
& './output/rollback/chatbot-fixes-20260913-125553/rollback.ps1' -Apply
```

The script checks every affected current file and backup hash before changing anything. If a file has been edited since this batch, it stops for manual review rather than overwriting later work. It preserves the earlier uncommitted working state. No rollback has been applied.

## Remaining professionalization work

The audit's broader roadmap remains separate from these defect fixes: a labeled multilingual intent/evaluation dataset, general multi-action planning beyond purchase-plus-policy requests, real operator notifications and assignment SLAs, audio/document understanding, document-version-based retrieval cache invalidation, and live staging/load evaluation. Keyword negation is a conservative safeguard, not complete natural-language understanding. Circuit/rate counters remain process-local; multiple application instances need shared counters for a global quota. Existing documents embedded with mock vectors should be re-ingested with a real embedding provider before relying on retrieval.
