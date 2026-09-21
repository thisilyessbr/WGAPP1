# Relayqo — Merchant Inbox UI Documentation (Phase 3C)

## 1. Overview & Business Context

Phase 3C delivers the merchant-facing WhatsApp Conversation Inbox within the Relayqo workspace (`/app/inbox`). It empowers Moroccan merchants to inspect incoming customer conversations, identify those requiring human attention, take over active conversations from AI automation, reply manually in real time, resolve issues, and reopen conversations to automated AI replies.

The frontend operates strictly against the authoritative Phase 3B backend APIs without calling Meta Cloud APIs directly and without introducing external JavaScript frameworks or WebSockets.

---

## 2. Files Modified and Created

### Frontend Source Files
1. **`src/portal/ui/inbox.js`** *(NEW)*:
   - Modular frontend controller (`window.RelayqoInbox`).
   - Encapsulates state management, conversation list rendering, transcript rendering, composer control, manual message sending with idempotency, action handlers (takeover, resolve, reopen), and dual-interval background polling.
2. **`src/portal/ui/portal.js`** *(MODIFIED)*:
   - Added `inbox: '✉'` icon to `icons` dictionary.
   - Added `<a href="/app/inbox" data-route>...Inbox...</a>` to sidebar `nav()` immediately after `Overview`.
   - Added `/app/inbox` and `/app/inbox/:id` routing in `render()` invoking `RelayqoInbox.renderInbox()`.
   - Connected `window.RelayqoInbox.cleanup()` to route change (`go()`) and re-render hooks.
3. **`src/portal/ui/portal.css`** *(MODIFIED)*:
   - Semantic status badges: `.status-ai-active`, `.status-needs-human`, `.status-human-active`, `.status-resolved` with full dark/light theme support.
   - Two-column responsive desktop layout (`.inbox-layout`, `.inbox-list-col`, `.inbox-detail-col`).
   - Distinct message bubble styling (`.msg-customer`, `.msg-ai`, `.msg-human`).
   - Delivery state indicators (`.delivery-pending`, `.delivery-sent`, `.delivery-failed`).
   - Mobile single-column collapse with Back navigation (`.inbox-back-btn`).
4. **`src/portal/ui/design.js`** *(MODIFIED)*:
   - Added `Inbox` SVG icon definition.
   - Added active navigation pattern matching for `/app/inbox` and `/app/inbox/*`.
5. **`src/portal/ui/i18n.js`** *(MODIFIED)*:
   - Added trilingual translations (English, French, Arabic) for all inbox UI labels, filters, badges, buttons, empty states, and Customer Service Window alerts.
6. **`src/portal/ui/index.html`** *(MODIFIED)*:
   - Registered `<script src="/portal-assets/inbox.js?v=20260921-inbox" defer></script>` before `portal.js`.

### Automated Test Files
7. **`tests/integration/merchant-inbox-browser.spec.ts`** *(NEW)*:
   - 31 automated Playwright browser integration tests validating all visual, operational, and edge-case behaviors against the real test database.

---

## 3. UI Architecture & Components

The inbox follows the established Relayqo vanilla JS SPA architecture:
- Single-instance controller attached to `window.RelayqoInbox`.
- Two-column responsive desktop layout:
  - **Left Column (`.inbox-list-col`)**: Search bar (debounced 300ms), horizontal filter bar (All, Open, Needs you, Human active, Resolved, Unread), scrollable conversation items list, unread indicators, pagination button.
  - **Right Column (`.inbox-detail-col`)**: Conversation header (customer name, phone, ownership badge, action buttons), Customer Service Window warning banner (when expired), scrollable chronological message transcript, and reply composer.
- Mobile viewport (`<= 760px`): Automatically collapses into a single-column drill-down flow. Selecting a conversation hides the list and displays the detail view with a prominent `‹ Back` button.

---

## 4. Authoritative Backend State & Semantic Badges

The UI never infers ownership or automation status from ad-hoc fields; it strictly reflects `ownership.state` from the Phase 3B backend:

| Authoritative Backend State | Visible Merchant Label | Semantic Badge Class | CSS Visual Appearance | Meaning |
| :--- | :--- | :--- | :--- | :--- |
| `AI_ACTIVE` | `AI active` | `.badge.status-ai-active` | Blue tint | AI automation actively answering customer messages. |
| `HUMAN_REQUIRED` | `Needs you` | `.badge.status-needs-human` | Orange tint | Customer requested handoff or automated AI yielded. |
| `HUMAN_ACTIVE` | `You’re handling this` | `.badge.status-human-active` | Lime/Green tint | Merchant took over; AI replies strictly suppressed. |
| `RESOLVED` | `Resolved` | `.badge.status-resolved` | Muted gray tint | Conversation concluded; inactive until customer messages again. |

---

## 5. Message Roles & Delivery Status Rendering

Messages within the transcript are distinguished visually and semantically:

| Role | Identifying Attributes | Class | Alignment & Style | Header Label |
| :--- | :--- | :--- | :--- | :--- |
| **Customer** | `role === 'USER'` | `.msg-customer` | Left-aligned, elevated background | `CUSTOMER` |
| **AI Reply** | `role === 'ASSISTANT' && !metadata?.manual` | `.msg-ai` | Right-aligned, soft green background | `AI` |
| **Merchant Reply** | `role === 'ASSISTANT' && metadata?.manual` | `.msg-human` | Right-aligned, green border accent | `YOU` |

### Outbound Delivery Lifecycle
For manual merchant messages, delivery status is displayed truthfully:
- **`PENDING`**: Displayed as `⏳ Sending…` (`.delivery-pending`).
- **`SENT`**: Displayed as `✓ Sent` (`.delivery-sent`), explicitly communicating provider acceptance without falsely claiming receipt or read status.
- **`FAILED`**: Displayed as `✕ Failed to send` (`.delivery-failed`) in red text, accompanied by an inline `Retry` button that reloads the message text into the composer.

---

## 6. Takeover, Resolve, Reopen & CSW Guardrails

1. **Take Over**:
   - Available for `HUMAN_REQUIRED` and `AI_ACTIVE` conversations.
   - Triggers `POST /api/client/conversations/:id/takeover`.
   - On server confirmation: immediate transition to `HUMAN_ACTIVE`, updates badge, enables composer, pauses AI.
2. **Reply Composer**:
   - Only enabled when ownership is `HUMAN_ACTIVE` **AND** `customerServiceWindow.canSendFreeform === true`.
   - Unclaimed conversations show: *"Take over this conversation to reply manually."*
   - Expired 24h CSW shows warning banner and disables composer: *"The WhatsApp customer-service window has expired. A free-form reply can't be sent."*
   - Duplicate-click protection: Send button disables immediately upon submission.
   - Idempotency key (`crypto.randomUUID()`) is sent via `Idempotency-Key` header and payload.
3. **Resolve**:
   - Available when `HUMAN_ACTIVE`. Triggers `POST /api/client/conversations/:id/resolve`.
   - Transitions state to `RESOLVED`.
4. **Reopen**:
   - Available when `RESOLVED`. Triggers `POST /api/client/conversations/:id/reopen`.
   - Restores conversation to `AI_ACTIVE`.

---

## 7. Polling & Background Throttling

- **Dual Interval Polling**:
  - Active conversation transcript poll: **4 seconds**.
  - Conversation list poll: **12 seconds**.
- **Concurrency Guard**:
  - `listFetchInProgress` and `detailFetchInProgress` flags prevent overlapping HTTP requests if a response is slow.
- **Background Tab Throttling**:
  - Automatically suspends polling intervals when `document.visibilityState === 'hidden'`.
- **Fail-Safe Polling**:
  - Network errors during polling do not erase currently rendered messages or reset form drafts.
- **Reactive State Sync (Test 31)**:
  - When active conversation poll detects a state change from the server (e.g. customer triggered handoff while conversation was open as `AI_ACTIVE`), the header badge and actions update immediately without a full page reload.

---

## 8. Security Considerations

- **Server-Side Authorization**: The frontend never determines access privileges. The backend enforces tenant isolation via authenticated session cookies and anti-IDOR checks.
- **CSRF Protection**: All mutation endpoints require the `X-CSRF-Token` header.
- **Output Sanitization**: All customer-provided text, phone numbers, and names are escaped via `esc()` before insertion into the DOM.
- **Zero Secrets**: No WhatsApp access tokens, Meta app secrets, or internal AI budgets are exposed to client JavaScript.

---

## 9. Automated Test Verification Matrix

All 4 test suites pass with **0 errors and 0 regressions**:

| Test Suite | Command | Tests Run | Result | Duration |
| :--- | :--- | :--- | :--- | :--- |
| **TypeScript Compilation** | `npm run typecheck` | Whole project | **PASS (0 errors)** | 3.5s |
| **Production Build** | `npm run build` | Prisma + tsc | **PASS (clean build)** | 14s |
| **Merchant Inbox Browser UI** | `npx vitest run tests/integration/merchant-inbox-browser.spec.ts` | 31 browser tests | **PASS (31/31 passed)** | 9.9s |
| **Merchant Inbox Backend** | `npx vitest run tests/integration/merchant-inbox-backend.spec.ts` | 26 integration tests | **PASS (26/26 passed)** | 11.6s |
| **Portal Integration & Browser** | `npm run test:portal` | 2 test files | **PASS (26/26 passed)** | 21.2s |
| **Web / Worker Separation** | `npx vitest run tests/integration/web-worker-separation.spec.ts` | 9 integration tests | **PASS (9/9 passed)** | 10.6s |
| **Production Security Remediation** | `npx vitest run tests/integration/production-security-remediation.spec.ts` | 21 security tests | **PASS (21/21 passed)** | 84ms |

---

## 10. Known Limitations & Roadmap to Phase 4

1. **WhatsApp Delivery Receipts**: Phase 3C truthfully displays `SENT` for messages accepted by the provider. Real delivery status (`DELIVERED`, `READ`) and receipt webhooks will be implemented in **Phase 4**.
2. **Template Messages**: Free-form replies outside the 24-hour Customer Service Window are disabled. Approved template message sending for expired windows will be introduced in future phases.
3. **Global Nav Unread Badge**: Deferred to a future release per architectural decision to avoid unnecessary polling on non-inbox portal pages.
