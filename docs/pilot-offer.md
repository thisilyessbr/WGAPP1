# Relayqo pilot offer (draft)

> Internal draft. Prices marked **[decide]** are suggestions, not decisions.

## Positioning

**"The WhatsApp assistant that understands how Moroccan customers really write: Darija, Arabizi, French, voice notes and photos. It answers, takes the order, and hands over to you when it matters."**

Don't lead with features. Lead with the three problems every merchant recognises:

1. Messages at night and on weekends that nobody answers, so orders are lost.
2. The same questions 50 times a day: price, size, delivery, "wach kayn?"
3. Voice notes and photos that take time to deal with.

## Who the first 5 pilots are

Pick **one niche**, so the five results make one strong story. Recommended:

- **Fashion, abaya and cosmetics shops selling on Instagram + WhatsApp with cash on delivery.** This is the strongest fit: catalog, variants, COD order flow, Darija voice notes and product photos.
- Alternative: salons and clinics that take bookings (calendar + reminders).

Selection criteria:
- At least **30 customer conversations per week** on WhatsApp. Below that, the result isn't measurable.
- An official WhatsApp Business number, or willingness to move to one (needed for broadcasts).
- The owner or one staff member who will answer handoffs within the day.

## The offer

**Pilot length:** 60 days.

**The merchant gets:**
- Setup done by us: catalog, prices, delivery rules, FAQ, tone. The bot is live within 48 hours.
- WhatsApp (and Instagram DM if in plan) answered 24/7 in Darija, Arabic, French and English.
- Orders/requests collected and sent to their inbox and email; customers who ask for a person are flagged, with a reminder if nobody answers within 15 minutes.
- Broadcasts to opted-in customers (approved by us during the pilot).
- A weekly 15-minute check-in and a results report at day 30 and day 60.
- Direct WhatsApp support from the founder.

**The merchant commits to:**
- Paying the pilot price.
- Answering handoffs and flagging wrong answers in the portal (one click). This is how the bot improves.
- A short testimonial or case study **if** the results are good (their choice to use their name).

**Pilot price:** **[decide]** Suggestion: **50% off the public price, locked for 12 months** for pilot clients who stay. For example 490 MAD/month during the pilot instead of 990 MAD/month. Charge from day 1. Free pilots don't produce honest feedback.

**Guarantee:** if after 30 days the bot hasn't saved them time or captured orders they would have missed, they can stop and the second month is free. This lowers the risk without making it free.

## Meta fees, explained upfront

WhatsApp charges businesses directly for some messages. Merchants need to know before they sign:

| Message | Who pays | Approximate cost in Morocco (+212) |
|---|---|---|
| Replies to a customer who wrote first (within 24 hours) | Free | $0 |
| Broadcast / marketing template | Merchant, billed by Meta | about **$0.041 per message** |
| Utility template (order update, reminder) | Merchant, billed by Meta | about **$0.023 per message** |

Example: a broadcast to 500 opted-in customers costs about **$21 (about 200 MAD)** in Meta fees. Relayqo shows the estimate before anything is sent.

*Rates are third-party figures for 1 Oct 2026. Check them against Meta's official rate card before quoting them in a contract.*

## What we measure (shown on the admin pilot scorecard)

| Metric | Good | Investigate |
|---|---|---|
| AI replies delivered | ≥ 98% | < 90% |
| Wrong answers flagged by the merchant | trending to 0 per week | any repeated mistake |
| Handoff rate (conversations needing a person) | 5–15% | > 35% |
| Leads / orders captured by the bot | rising week over week | flat |
| Missed questions | falling | rising |

At day 30, the report to the merchant answers one question: **"How many orders/requests did the bot handle that you would otherwise have answered yourself, or lost?"**

## Pitch messages

**Darija (WhatsApp, first contact):**

> Salam [Smiya] 👋 Ana [Smiytek] mn Relayqo. Kankhdmo m3a les boutiques f l Maghrib: assistant f WhatsApp kayjawb l clients dyalk b Darija, b français, w hta les vocaux w tsawer — 24/24, w kayakhd lcommande w kaysiftha lik.
> Kan9lbo 3la 5 boutiques bach ndiro m3ahom pilote dyal 2 chhor b nos taman (50% reduction). Ila bghiti nwrik demo 10 d9aye9 b les produits dyalk, goul liya ach men nhar mnasb lik.

**French (WhatsApp or email):**

> Bonjour [Prénom], je suis [Nom], fondateur de Relayqo. Nous aidons les boutiques marocaines à répondre sur WhatsApp 24h/24, en darija comme en français, y compris aux messages vocaux et aux photos. L'assistant prend les commandes et vous passe la main quand un client veut parler à quelqu'un.
> Nous lançons un pilote de 60 jours avec 5 boutiques, à tarif réduit et garanti pendant 12 mois. Puis-je vous montrer une démo de 10 minutes avec vos propres produits ?

**Demo tip:** record a 30-second screen video of the bot answering a messy Darija voice note ("chhal hadi? kayna f L?") with the merchant's real product. Send that before the call.

## Objections

- **"The bot will say something wrong to my customers."** It only answers from your catalog and rules, hands over when unsure, and you can flag any answer in one click. We review every flag during the pilot.
- **"My customers prefer talking to a person."** They still can: it hands over immediately when asked, and you get an alert. The bot handles the repetitive 70%.
- **"It's expensive."** Compare it to one missed order per day. Show the pilot scorecard numbers from a similar shop as soon as you have them.
- **"I use the normal WhatsApp app."** The bot can work on the QR connection for replies, but broadcasts need an official number. We set that up with them.

## Referral loop

Each pilot client who refers a merchant who signs gets **one free month**. Moroccan merchant circles are tight, so this will beat paid ads early on.

## Before the first pilot starts (checklist)

- [ ] Worker env set: `OPERATOR_ALERT_WEBHOOK_URL` or `OPERATOR_ALERT_EMAILS`, `PORTAL_STAFF_ALERT_WORKER=true`.
- [ ] Decide pilot price and guarantee wording.
- [ ] `BROADCASTS_ENABLED=true` on the worker once the first merchant has an approved template.
- [ ] Verify the Meta rates above on Meta's official rate card.
- [ ] Prepare the day-30 report template from the pilot scorecard.
