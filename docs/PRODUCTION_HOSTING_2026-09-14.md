# Relayqo production hosting plan

## Decision

Do not buy or manage a VPS for the first production release. Deploy the existing Docker application as one paid Render web service and keep PostgreSQL on Supabase. Keep the marketing website on `relayqo.online` and host the authenticated portal, API, worker, and WhatsApp webhook on `app.relayqo.online`.

The application already starts its PostgreSQL-backed WhatsApp queue worker in the same process as Express. One Starter service is therefore enough for the first clients. Split the worker into its own service only after real traffic shows sustained queue delay or CPU pressure.

Cloudflare Tunnel is not required. A Quick Tunnel is useful for local experiments but has a random hostname and no production uptime guarantee. A named Cloudflare Tunnel can use a stable custom hostname, but it still needs an always-on computer or server running both Relayqo and `cloudflared`; it does not replace hosting.

## Target layout

| Address or service | Purpose |
| --- | --- |
| `relayqo.online` and `www.relayqo.online` | Existing marketing site on Vercel |
| `app.relayqo.online` | Render web service: portal, API, webhook, message worker |
| Supabase | PostgreSQL database and durable queue |
| Meta Cloud API | Official WhatsApp transport |
| Resend | Verification, password reset, and admin login emails |

Keep `ENABLE_QR_CHANNELS=false`. QR sessions need persistent browser state and a dedicated long-running worker and are not part of the first production release.

## Expected starting cost

- Render Hobby workspace: $0/month plus compute.
- One Render Starter web service: about $7/month.
- Supabase: keep the current plan until its limits require an upgrade.
- Resend: free for the initial transactional email volume.
- Meta WhatsApp and DeepSeek: usage based.

## Deploy in this order

1. Rotate every credential that was pasted into chat before using the service with real customers: the database password, Meta app secret, WhatsApp token, webhook verification token, DeepSeek key, and Google key.
2. Create a Resend account, verify `relayqo.online`, and create an API key. The sender is already configured as `Relayqo <auth@relayqo.online>`.
3. Push the repository to a private GitHub repository.
4. In Render, create a Blueprint from the repository's `render.yaml`. Use the Starter compute plan already declared by the Blueprint.
5. Enter the secret values requested by Render, including the new Resend key. `DATABASE_URL` should use the Supabase transaction pooler. `DIRECT_URL` should be the Supabase direct or session-pooler URL used for migrations. URL-encode special characters in the database password.
6. In the Render service, add and verify `app.relayqo.online` if the Blueprint has not done so automatically. At the current DNS provider, add the CNAME value shown by Render. Do not move the root marketing domain away from Vercel.
7. Confirm these URLs work over HTTPS:
   - `https://app.relayqo.online/health`
   - `https://app.relayqo.online/signup`
   - `https://app.relayqo.online/login`
8. Run `npm run portal:admin -- --email YOUR_EMAIL --name "Relayqo Admin"` as a Render one-off job or shell command to create the first administrator. Do not put the password in command history; the script prompts for it.

## Meta configuration

Use the stable Render domain everywhere. Do not register a `trycloudflare.com` hostname.

1. Meta app settings:
   - App domain: `app.relayqo.online`
   - Privacy policy: `https://relayqo.online/privacy`
   - Terms: `https://relayqo.online/terms`
   - Data deletion: `https://relayqo.online/data-deletion`
2. Facebook Login for Business settings:
   - Client OAuth Login: Yes
   - Web OAuth Login: Yes
   - Enforce HTTPS: Yes
   - Embedded Browser OAuth Login: Yes
   - Login with the JavaScript SDK: Yes
   - Allowed Domains for the JavaScript SDK: `app.relayqo.online`
   - Valid OAuth Redirect URI: `https://app.relayqo.online/app/whatsapp`
3. Create a WhatsApp Embedded Signup configuration from Meta's full-access 60-day-token template. Give it a name under 30 characters, such as `Relayqo WhatsApp Signup`. Set the resulting configuration ID as `META_CONFIG_ID` in Render.
4. WhatsApp webhook:
   - Callback URL: `https://app.relayqo.online/api/v1/webhook/whatsapp`
   - Verification token: the new value stored as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Render
   - Subscribe to the `messages` field.
5. Keep the Meta app unpublished while testing with app roles and test assets. Complete business verification, permissions review, and Live mode before onboarding unrelated client businesses.

## Acceptance test

1. Open an incognito window and create a client account.
2. Verify the email, then log in with the password.
3. Fill in business data and submit it.
4. Log in as the administrator, assign a published plan, approve and publish the business data, and activate the account.
5. Return to the client account and open WhatsApp. Complete Meta Embedded Signup with a test or owned business number.
6. Send `salam` from another WhatsApp number. Confirm a Darija response arrives once, the conversation appears in the portal, usage is recorded, and the queue has no failed job.
7. Test English, French, Darija Latin, Darija Arabic, a FAQ, a product question, an unknown question, and a workflow that collects several fields.

## Scaling trigger

Keep one service while response times and queue delay remain healthy. Add a separate background worker when message processing competes with web requests, documents wait too long, or the web service needs more than one instance. The PostgreSQL queue already uses leases and row locking, so this can be done without replacing the queue.
