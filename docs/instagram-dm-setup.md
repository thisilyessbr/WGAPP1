# Relayqo Instagram DM setup

Relayqo uses one Meta app for Instagram Login and gives each client a separate Instagram authorization. A client does not need to create a developer app. The account they connect must be an Instagram professional account. This integration answers incoming private text messages only; it does not automate comments, posts, or outbound marketing.

## Operator setup

1. In Meta for Developers, use the Relayqo developer app (`2065382794081122`). Its **Instagram API with Instagram Login** use case was added and its Instagram app ID is `2281348042642213`. Request only `instagram_business_basic` and `instagram_business_manage_messages` for this DM-only integration. Do not request comment or content publishing permissions. Meta currently shows this app as **In development**, and its Instagram setup says webhooks require the app to be published and external accounts require app review/advanced access.
2. The Instagram Login redirect URI was saved as:
   `https://app.relayqo.online/api/instagram/connect/callback`
3. Configure the Instagram webhook callback URL:
   `https://app.relayqo.online/api/instagram/webhook`
   Select the `messages` webhook field. Set the verify token to the value of `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` in Render.
4. In Render, set `INSTAGRAM_APP_ID=2281348042642213`, `INSTAGRAM_APP_SECRET`, and `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. Use the **Instagram** app secret from the Instagram API setup page, which is distinct from the Facebook/WhatsApp app secret, and keep it server-side. The optional `INSTAGRAM_GRAPH_API_VERSION` defaults to `v26.0`. Redeploy after updating these values.
5. Check the deployment health and verify that `/app/instagram` shows **Connect Instagram** enabled.

## Client connection and test

1. Assign and approve the client's plan. The client signs in to their Relayqo account and opens **Instagram**.
2. The client clicks **Connect Instagram**, signs in to their own Instagram professional account, and grants messaging access. Relayqo stores the resulting access token encrypted. The app must be able to subscribe the account to the `messages` webhook before the connection appears.
3. The connection starts with chatbot replies paused. In **Admin → Clients → [client]**, enable Instagram replies for that account.
4. From a different Instagram account, send a text DM to the connected account. Check that the message appears in the Relayqo inbox with an **Instagram** badge and that a reply arrives. Test a human takeover and manual reply in the same conversation.
5. Test a second client account separately, including a case where Meta refuses to grant the app access. A connected profile cannot be assigned to two Relayqo accounts.

## Operational notes

- Relayqo verifies the raw webhook body with Meta's signature, resolves the destination Instagram profile to exactly one client account, and deduplicates messages before the shared chatbot engine runs. The customer's Instagram identity is namespaced by destination profile, separate from WhatsApp.
- Instagram access tokens expire. Relayqo refreshes them shortly before expiry when it sends a message. If Meta revokes access, the client must reconnect.
- The automatic send worker does not replay a send with an unknown outcome, avoiding duplicate replies. Failed/unknown jobs are visible in `InstagramInboundJob` for operator review.
- The inbox's manual-reply route uses the same 24-hour customer service guard as WhatsApp. Confirm current Meta messaging policies during the live pilot.
- Do not advertise Instagram support to external customers until a real non-role account can connect and exchange DMs under Meta's approved access level.

Meta API references: [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login) and [Instagram Send API](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api).
