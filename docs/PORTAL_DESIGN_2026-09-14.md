# Portal appearance and local email testing

The portal now defaults to dark mode. The theme button switches between dark and light and remembers the preference on that browser. The circular lime Relayqo logo matches the CSS mark on relayqo.online. No remote assets or new runtime dependencies were added.

Business information is grouped into Profile, Policies, Products, Services, FAQs and Documents tabs. Account controls are grouped into Overview, Chatbot & limits, Statistics, Documents, Conversations and History. Data and save handlers are retained when changing tabs; the selected section survives a refresh. Mobile layouts retain theme and logout controls, with horizontal scrolling confined to navigation and tables.

## Local testing

This workspace's `.env` now has `PORTAL_DEV_SKIP_EMAIL=true`, alongside the existing `PORTAL_DEV_AUTH_LINKS=true`. New clients are sent to the login page after signup and must enter their credentials. Signup does not create a session. Existing clients and administrators log in with their password without an email confirmation step. Password reset links remain available locally through the development-link flow.

The bypass requires a loopback `PORTAL_PUBLIC_URL` and is ignored when `NODE_ENV=production`. It never marks an email as verified. Setting `PORTAL_DEV_SKIP_EMAIL=false` and restarting restores verification checks, including for sessions belonging to unverified test users. Public deployment still needs real email delivery configured.

## Verification

- Application build and JavaScript syntax checks passed.
- 26 API, access-control and configuration tests passed; report: `output/portal-verification/design-api-results.json`.
- Browser review used an isolated, in-memory PostgreSQL fixture. Checked client dashboard, product editing/save/reload, Documents tab, admin account navigation, plan controls/save and Statistics tab. No browser errors in this flow.
- Checked dark and light themes, saved theme preference and the 390px mobile layout with no horizontal page overflow.
- Confirmed the actual localhost:3000 signup page loads the new design and displays the local email-testing notice.
- The existing browser regression test was updated for the new tabs. The browser flow was checked interactively in this revision; that automated browser test was not rerun.

No production deployment, real account edits, email delivery, WhatsApp sends or paid AI calls were used for these design checks.

## Rollback

`output/rollback/portal-design-20260914/rollback.ps1` verifies file hashes by default. Run with `-Apply` to restore the previous source files and rebuild; restart the server afterward. The script stops if a file has changed since this revision. Earlier chatbot, cost and portal work is preserved.

The local environment setting is recorded separately in `local-setting.json`. To restore the previous local setting, remove `PORTAL_DEV_SKIP_EMAIL=true` from `.env`; no credentials need changing.

## Session navigation correction

Login, signup and forgot-password pages now check the server session and redirect signed-in users to their client or admin dashboard. Authentication transitions replace the current history entry; Back/Forward navigation and restored pages recheck the session. Logout and expired sessions return to login. A temporary server failure shows a retry screen instead of assuming the user logged out.

Build and 33 targeted checks passed, including separate signup/login, both roles, Back/Forward, logout, expiry and cached-page restoration. Browser verification confirmed login/signup redirects and Back/Forward with the existing client session. The session-flow rollback is in `output/rollback/portal-session-20260914`; earlier design work is preserved.
