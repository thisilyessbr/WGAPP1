# Staff actions release

## Staff workflow

- Open **Today** to see waiting human handoffs, new requests and due follow-ups. Each list shows at most 25 actions; use Inbox, Requests/Leads or Answer reviews for the full workspace.
- Assign a request to an existing member of that account and select a follow-up time. Assignment does not change the chatbot or automatically contact a customer.
- Use **Report answer** on a chatbot message to explain an incorrect answer. Administrators edit the business knowledge, test the draft, publish it, test the published answer, and record the correction before marking it reviewed. This does not train or automatically change the model.

## Production activation

1. Deploy the branch and run `npx prisma migrate deploy` before the new application starts. The migration is additive; it preserves existing conversations and requests.
2. Set `PORTAL_STAFF_ALERT_WORKER=true` on the service running the worker. Existing manual Render services must set this explicitly; the blueprint includes it.
3. Keep `RESEND_API_KEY`, `PORTAL_MAIL_FROM` and the HTTPS `PORTAL_PUBLIC_URL` configured. Missing email credentials leave the in-app queue available but do not send alerts.
4. Use a verified account member with a real inbox for the live email check. Addresses ending in `.test`, preview chats and inactive accounts are excluded.
5. Trigger a new human handoff, a new request and a follow-up due now. Confirm the appropriate inbox receives each alert and its link opens the correct account. Repeat a scan to verify no duplicate mail. No production mail was sent by the automated tests.

## Delivery behaviour

The worker checks every minute and delivers up to 10 queued emails per tick. Unassigned requests notify eligible account members; assigned requests notify only the assignee. Alerts contain a workspace link rather than conversation contents. The first rollout scans the preceding hour; a persistent checkpoint catches up after subsequent downtime. Provider failures retry up to five times with backoff and stable idempotency keys. Closed, reassigned or rescheduled requests are checked again before delivery.

## Verification and rollback

The production build and 48 focused tests pass, including real PostgreSQL-compatible migration/query tests and desktop, mobile and Arabic browser checks. They cover account isolation, duplicate suppression, assignment validation, published-answer retest requirements, delivery retries and outage recovery.

To stop email delivery, set `PORTAL_STAFF_ALERT_WORKER=false` and restart the worker. To roll back the UI/application, redeploy the preceding commit; leave the additive database tables in place to preserve reviews and delivery history.
