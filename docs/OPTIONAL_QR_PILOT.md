# Optional QR pilot

The official Meta API remains the default and recommended connection. QR is an
optional unofficial linked-device transport. Client consent does not make it
official or guarantee that WhatsApp will not disconnect or restrict the number.

## Client onboarding

1. Keep the client's official API number connected. Do not attach the same number
   to both transports or transfer another client's number implicitly.
2. In Admin → Plans, create a draft using **Service Assistant · QR Pilot** or
   **Sales Assistant · QR Pilot**. Review prices and limits before publishing.
   Both presets allow two numbers total; the official and QR numbers share that
   allowance. Existing client plan snapshots do not change automatically.
3. Assign the chosen plan to the client and approve the account.
4. In the client's admin screen, select **Allow QR**. This alone does not enable
   a disconnected or suspended individual connection.
5. The client opens WhatsApp in their Relayqo workspace, reads the experimental
   QR notice, checks acceptance, and clicks **Add number with QR**.
6. On the phone for the additional number: WhatsApp → Linked devices → Link a
   device. Scan only the QR shown in that client's authenticated workspace.
7. Activate the account after setup and send a text from a separate number.
   Check the reply, inbox, and account usage. A real scan/send test is still
   required; automated tests use a mocked WhatsApp socket.
8. To stop it, the client selects **Disconnect QR**, or the admin disables QR or
   the individual connection. To resume an admin-paused connection, the admin
   must explicitly enable it; the client can then use Reconnect if necessary.

## Runtime requirements

Use one always-on application process for the initial pilot, running both queue
consumption and QR sessions. Keep `ENABLE_QR_CHANNELS=false` on sleeping/free web
services. The global flag must be explicitly enabled on suitable infrastructure;
no production service settings are changed by this patch.

PostgreSQL stores encrypted linked-device authentication, encrypted expiring QR
codes, and session ownership leases. Preserve the database and the existing
SecretBox encryption key across restarts. Never log or export authentication
state or QR codes. Worker leases last 90 seconds and renew every 20 seconds;
expired leases can be claimed again. QR codes expire after 60 seconds.

Leases prevent competing processes from opening the same session; they do not
provide complete routing of outbound jobs to the owning worker. Multiple QR
workers need explicit job dispatch to the session owner before scaling out.
Do not enable independent web and queue workers as a production QR cluster yet.

## Implemented limits

- QR requires the global switch, a QR plan, admin approval, accepted client
  limitations, and an approved/active account. Replies require ACTIVE status.
- Official API and QR connection attempts share the account's number limit.
- Inbound processing accepts new individual text messages only. History, own
  messages, groups, status posts, and unresolved device identifiers are ignored.
  Supported phone-number JIDs, including alternate phone IDs, are normalized.
- QR supports text replies only. Audio, product images and message templates
  remain unsupported through this transport even if an API channel supports them.
- An outbound QR reply requires an incoming message from that customer within
  the previous 24 hours. This is Relayqo's safeguard, not an official QR policy.
- Shared database counters allow at most 12 sends/minute per connection and
  4/minute per recipient. These conservative pilot ceilings are not a guarantee
  of compliance or protection from restrictions. No bulk campaigns are supported.
- Reconnect delays are 5, 10, 20, 40 and 60 seconds. Repeated transient failures
  stop the session for admin review. Logout/replaced/bad sessions do not retry
  automatically. Retry count resets only after a healthy ten-minute session.
- A send whose delivery outcome is unknown is not automatically resent; review
  the conversation to avoid duplicate replies.
- Revoked access stops subsequent sends immediately and closes the local socket
  on its next heartbeat. A send already in flight may finish.
- Connection-scoped message IDs and tenant/account queue partitions prevent
  collisions between clients. A number already mapped to another connection is
  rejected instead of reassigned.

## Release and rollback

Apply migration `20260928030000_optional_qr_pilot` before running this code.
It adds tables/approval fields and deliberately pauses existing QR connections;
official API connections are unaffected. Admins must approve QR accounts and
resume permitted connections. Prior client acceptance timestamps remain recorded
when access is revoked; acceptance by itself never grants access.

For an operational rollback, set `ENABLE_QR_CHANNELS=false`, stop the QR process,
and use the existing emergency QR stop. Keep API connections serving normally.
Retain the additive database tables if reverting code. Do not restore old QR
workers with the flag enabled, as they lack these approval/ownership checks.

Suggested prices are editable drafts, not subscriptions automatically sold to
clients. Hosting costs and unofficial transport maintenance must be included in
your final prices. Do not market QR as equivalent to the official API.

## Validation

Focused tests cover real PostgreSQL SQL/constraints with PGlite, mocked Baileys
events, and real Chromium onboarding pages (English/Arabic and mobile). The
existing `whatsapp-security-remediation.spec.ts` suite additionally needs a
separate `TEST_DATABASE_URL`; it was not run against the live client database.
No real phone was scanned or messaged as part of these automated checks.
