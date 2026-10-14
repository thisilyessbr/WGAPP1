# Security and critical bug remediation — 28 September 2026

## Scope and release status

This patch fixes the eight distinct issues demonstrated in the second security audit. Nine original regression probes cover them because Instagram suspension was tested for both automated and manual sending. Changes are isolated on `codex/security-critical-fixes`; the original working directory was preserved. No production customer data, credentials, provider messages or settings were modified for these tests.

The branch depends on the project-audit fixes (PR #41) and optional QR pilot (PR #42). This is a reviewable patch, not a confirmation of a production deployment. Keep QR globally disabled until a dedicated, always-on worker and its operational requirements are available. Official Meta API remains the default.

## Remediation

| Audited issue | Implemented safeguard | Verification |
| --- | --- | --- |
| Instagram connection ownership changes during generation | Exact tenant/account/Instagram identity and connection status are rechecked before sending, including after token resolution. Token refresh updates require the original ownership and token snapshot to match. | Generation-time ownership probe; actual provider-boundary tests. |
| Stale QR routing loses its original account scope | Transport passes the expected tenant, account and phone-number mapping to the worker. It verifies the mapping, current ownership, permission and worker lease before delivery, and rechecks after throttling. | Stale-owner probe; existing isolated QR database tests. |
| Paid voice transcription bypasses allowances and can be repeated | Reserve message usage and a bounded monetary ceiling before download/transcription. Share the account's normal spending bucket. Cache transcripts with a durable account/message key, prevent concurrent duplicate calls, retain uncertain charges and never replay uncertain provider operations. | Isolated database tests for exhausted limits, concurrent duplicates and distinct messages, client isolation, retries and unknown outcomes. |
| Custom workflow patterns can block the process | Use bounded RE2/WASM patterns instead of native backtracking expressions. Reject unsupported/oversized patterns on configuration save; runtime fails closed for old invalid patterns. Input length and compiled-pattern cache are bounded. | Former catastrophic pattern runs in an isolated child within the deadline; syntax, Unicode and legacy-key tests. |
| Expired Instagram jobs can deliver duplicate replies | Renew processing/sending leases. Every state transition requires a live lease and the same monotonically increasing claim attempt. A resumed stale worker cannot save or send. Pending jobs are serialized per scoped customer, and uncertain sends are never automatically replayed. | PostgreSQL reclaim-and-resume reproduction; heartbeat test. |
| Instagram AI replies ignore a new human takeover | Recheck conversation takeover after generation, when using cached responses, and at the final automated provider boundary after token resolution. | Takeover-generation probe and provider-boundary test. |
| Suspended accounts can still send Instagram replies | Require ACTIVE status and plan/admin entitlement on automated and manual paths, including final sending checks. | Both suspension probes and provider-boundary test. |
| Storage downgrades omit product photos | Count documents for the document allowance and aggregate document plus product-photo bytes for storage in both plan changes and per-account overrides. | Real database fixtures reject both kinds of downgrade with stored photos exceeding the ceiling. |

## Voice behavior and operational limits

- Voice notes are limited to 5 MB and five minutes; the settings hint is translated into English, French and Arabic.
- Parse the actual media duration before making a paid transcription request. Unreadable or overlong recordings request a written message instead.
- Only the admin-selected provider is called. No automatic paid fallback to a second provider is introduced.
- Audio consumes one customer-message unit, reused by the subsequent chatbot turn, and shares the account's estimated monthly AI spend ceiling.
- An uncertain provider outcome retains the full reservation as an estimated charge. If its transcript was received, reuse it. An interrupted reservation older than three minutes is settled conservatively when retried; it is not replayed. Provider billing reconciliation remains an operational task.
- The reservation uses a conservative five-minute estimate; a short recording can be refused near the spending ceiling even if its final charge would have fit. This avoids overspending before its duration is known.
- Custom patterns requiring lookarounds or backreferences must be replaced with supported RE2 expressions; existing unsupported patterns fail validation rather than executing natively.

## Validation and limitations

Final verification: production build passed; 82 focused tests passed across 9 files; 1026 broad runnable tests passed across 78 files, with zero failures. The broad runnable suite includes unit tests plus isolated database/browser tests. Eight older suites cannot start without `TEST_DATABASE_URL`; the production database is never used as a substitute. Exact suite names and full machine-readable results are saved under ignored `output/audits/security-fixes-*.json`.

Two unrelated outdated test fixtures were corrected during broad validation: the reminder test now schedules a future reminder instead of using a date that has passed, and the plan test verifies all six offers independently of rendering order.

The dependency audit reports no published advisories for the resulting lockfile. These checks establish regression coverage for the reported flaws, not a guarantee that no other vulnerability exists or that a live Meta/QR session was tested.

## Rollback

No new database migration is required by this patch. Revert the security-fix commit to restore the prior code if necessary; doing so restores the audited weaknesses. Keep the affected channel/voice options disabled during such a rollback. Completed or estimated audio usage entries remain recorded and should not be erased to reset spending. Retain the prior deployment for recovery, and verify official API message delivery, tenant isolation and usage attribution after releasing the fixes.
