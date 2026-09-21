# Production re-audit after fixes

Verdict after remediation: the two code findings from this re-audit are fixed. Local code checks pass. Production approval still requires deployment-specific verification against the permanent backend and Meta.

## Remediation update

Delivery receipt follow-up fixed: both text and template HTTP-success responses now require a non-empty string message ID in a messages array and no error payload. Malformed JSON or missing/invalid receipts return DELIVERY_UNKNOWN with automatic retries disabled. The existing queue handling records these as FAILED/UNKNOWN for reconciliation. Eighteen new receipt checks plus routing and previous audit regressions passed (29/29 in this focused run); the production build passed. This verifies local response handling, not actual Meta delivery.

Provider-test completion: all five tests in `tests/integration/llm-factory.spec.ts` now pass. The suite explicitly exercises provider classes with HTTP responses stubbed, restores environment/global state after each test, verifies non-retryable authentication errors and three timeout attempts, and uses no live credentials. Combined with the seven focused regression files, the final run passed 48/48 tests across eight files. This resolves the three previously failing provider tests; it does not establish that the complete repository test suite or live Meta deployment has passed.

- Customer-scoped credentials are restricted to POST /chat for their signed customer identity. They cannot access tenant configuration, knowledge, products, CRM, diagnostics, or other tenant APIs.
- All non-chat POST, PUT, PATCH, and DELETE operations require an administrator role. Platform-wide tenant creation remains restricted to the platform API key.
- A missing DeepSeek key now raises an authentication configuration error in production instead of selecting the mock provider. Startup also refuses production when neither DeepSeek nor Google credentials are configured.
- Desired-behavior tests cover both a customer-scoped token and a tenant-level non-admin token. The production provider test requires a clear error.

Production build/typecheck and the focused security regression set pass after these changes. Older tests that expect an ordinary tenant admin to create a new global tenant are stale relative to the intended platform-admin boundary and should be updated to use the platform API key.

## Resolved findings

### P1 resolved: Customer credentials could modify tenant-wide configuration

`src/dev/chatApi.ts:746`: POST /config authenticates the tenant but does not require an administrator role. The recent narrowing of channel middleware makes this underlying gap reachable through createApp. A signed role=user token restricted to customer-a successfully POSTs /api/v1/config and calls tenantConfigService.updateConfig for the entire tenant. Customer scope is enforced in /chat but not here.

Resolution: customer-scoped credentials now receive HTTP 403 outside POST /chat, and every other state-changing API operation requires an administrator. Regression tests verify that neither customer-scoped nor tenant-level non-admin credentials can update configuration.

### P2 resolved: Production could silently serve a mock AI provider

`src/core/llm/LLMFactory.ts:49`: a missing or dummy DeepSeek key selects LLMMockProvider even with NODE_ENV=production. Startup only warns about a missing DeepSeek key. A deployment configuration error therefore looks like a working bot while returning test-provider output.

Resolution: production throws a provider authentication error when DeepSeek is selected without its key, and startup fails when no production AI key exists. Mock fallback remains limited to test and development use.

## Fresh verification

- Production build, including generated Prisma client and application type checking: passed.
- Existing six focused regression files: 40 tests passed.
- Two new evidence tests passed by reproducing the remaining defects. They are not desired-behavior regression gates.
- All 18 migrations applied successfully to a new isolated local database.
- Three selected PostgreSQL queue tests passed: heartbeat while slow handler runs and queue shutdown drains, stale-worker fencing, and uncertain-send recovery. Eight other tests in that file were intentionally excluded for this focused rerun.
- Diff whitespace validation: passed.

The previous local queue test gap is now closed for those three scenarios. This is not a full process SIGTERM/deployment rehearsal or a guarantee of exactly-once external delivery.

## Scope and release requirements

This re-audit checked local backend fixes and added evidence tests. It did not change production code, contact real customers, deploy the backend, inspect current hosting credentials, recheck dependency advisories, run the complete repository suite, or revalidate live Meta settings.

Resolve the two findings, convert their evidence tests to expected-denial/error regressions, validate administrative role boundaries, then test the deployed permanent webhook end to end. Also document the operator procedure for UNKNOWN delivery records before clients depend on the service. Do not interpret passing builds or local tests as live production verification.
