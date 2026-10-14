# Client-owned WhatsApp connection pilot

Each client uses their own Meta app, WhatsApp Business Account (WABA), and phone number. Relayqo stores a separate encrypted access token and app secret for each client. The existing Relayqo Meta app is not used for this path. One client can connect two numbers under the same WABA and app when their assigned plan allows two numbers.

## Before the appointment

1. In Relayqo Admin, assign the client a plan with the required number allowance, approve the account, and publish the chatbot data.
2. Ask the client to sign in to their own Meta Business Suite and Meta for Developers account. The client should retain ownership and never send login passwords or SMS codes to Relayqo.
3. In the client's Meta app, add WhatsApp, select or create their WABA, and add the phone number. Complete Meta's phone-code verification and any registration steps shown for that number. Record the app ID, WABA ID, and **phone number ID** (the numeric Graph ID, not the displayed phone number).
4. Create a system-user token for the client's app with `whatsapp_business_management` and `whatsapp_business_messaging`. The temporary dashboard token is unsuitable for an ongoing connection. Keep the app secret and token private.

## Connect in Relayqo

1. Open Admin → Client accounts → the client → **Connect this client's Meta app**.
2. With the client present, enter the app ID, app secret, WABA ID, phone number ID, and system-user access token. Relayqo checks that the token belongs to the app and that the phone belongs to the WABA. The token and app secret are encrypted at rest.
3. Copy the callback URL and verification token shown by Relayqo into the **WhatsApp webhook configuration of the client's Meta app**. Subscribe to the `messages` field. Meta's successful callback challenge changes the connection to `WEBHOOK_VERIFIED`.
4. Reload the Relayqo admin client page. If needed, open the setup again from the connection ID. Click **Activate after Meta verification**. Relayqo subscribes the app to the WABA and enables that client's number. This does not replace Meta's own number registration or messaging eligibility checks.
5. Send a message to the connected business number from a different WhatsApp account. Verify the message appears in the correct client's Relayqo inbox and that the chatbot replies. Check delivery status. Then send a message to the original Relayqo test number and verify the conversations stay separate.

## Second number

Repeat the Relayqo preparation with the second phone number ID under the same client app and WABA. The callback URL and verification token stay the same; the existing number remains active. Activate again after the second number is ready. A plan with a one-number allowance blocks this step. If the second number is in a different WABA, use a separate Meta app until app-level callback overrides are implemented.

## Troubleshooting

- **App not active** on the old Connect with Meta popup: that is the Relayqo-owned app, not this client-owned route. Use the admin connection form above.
- **Meta token app or permissions invalid:** regenerate a token for the client's app with both required permissions.
- **Number not in WABA:** use the numeric phone number ID from the selected WABA, not the displayed number or another WABA's ID.
- **Webhook not verified:** confirm the callback URL and verify token match exactly, are publicly reachable over HTTPS, and that Meta completed the challenge.
- **Connected but no reply:** confirm Meta phone registration, WABA subscription, webhook `messages` field, and the client's Relayqo account status. Inspect delivery errors in the admin dashboard.

Meta references: [Cloud API setup](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [WABA subscription](https://www.postman.com/meta/whatsapp-business-platform/request/c1ai24q/subscribe-to-your-waba).
