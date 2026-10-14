# Relayqo: live Moroccan salon evaluation

Date: 24 September 2026. Verdict: useful for supervised demonstrations, not ready for an unattended paid salon launch.

## Business and scope

Tested a fictional hair salon in Maarif, Casablanca. This is a practical fit for the existing service-information and appointment-request features, not evidence of market demand. Services: haircut 120 MAD/45 minutes, brushing 80 MAD/30 minutes, coloration 350 MAD/90 minutes. Hours: Tuesday–Sunday 10:00–19:00; closed Monday. Changes/cancellations free at least 24 hours before the appointment. Staff must confirm appointment times.

Executed 29 customer turns across 22 scenarios, using the real ConversationEngine, WorkflowEngine, and DeepSeek provider configured by the application (`deepseek-flash`). Persistence was an isolated in-memory adapter. Business facts and multilingual FAQs were supplied directly through the portal configuration structure; document retrieval/embeddings were disabled. No client data was edited, no WhatsApp messages were sent, and no database, CRM integration, calendar integration, delivery reliability, or staff notification was tested.

## Findings from manual transcript review

Six turns had clear quality or workflow failures, representing five issues. This is a small, hand-selected sample, not a statistical production accuracy estimate.

| Priority | Customer message | Observed answer/behavior | Required improvement |
|---|---|---|---|
| High | `bchhal brushing?` | French answer: `Brushing seul: 80 MAD, environ 30 minutes.` An AI call was used despite an exact Darija FAQ being configured. | Recognize common Darija spelling variants and retain the FAQ language. `bchhal` is missing from the language detector's Darija vocabulary. |
| High | `Le brushing coûte combien, dure combien de temps et vous fermez à quelle heure ?` | FAQ answer supplied 80 MAD and 30 minutes but omitted the closing time (19:00). | Detect all requested business facts before returning a single FAQ. Current guards focus on policy combinations rather than price/duration/hours combinations. |
| High | After asking about coloration: `Et ça dure combien de temps ?` | `Quelle prestation ? Coupe femme : 45 min. Brushing : 30 min. Coloration : 90 min.` | Preserve the selected service on follow-up turns. Grounded generation currently receives the question and evidence without recent conversation turns. |
| High | `Je veux réserver`, followed by `2` | Workflow replied `Which service would you like?`, then `Your name, please?`, despite configured French prompts. | Detect short French booking requests correctly and preserve that language on numeric replies. The detector does not recognize `je`, `veux`, or `réserver` here. |
| High | During intake: `safi bghit nlghi` | Asked the user to continue choosing a service; session remained ACTIVE. | Recognize natural cancellation phrases, while preserving the distinction between a cancellation command and a question about cancellation policy. Current detector relies heavily on exact phrases. |

Additional wording risk: when asked to confirm tomorrow at 15:00, the bot correctly refused to guarantee a slot but said the request “sera enregistrée”; no intake session was created. Generated replies should direct the user to the intake process without implying that an action has been or will automatically be performed.

Handoff state was saved and the next customer message received no bot response. The acknowledgement says a human was notified; this evaluation did not test a real staff alert, so that promise remains unverified.

## What worked in this sample

- Exact French, English and Arabic FAQs returned correct price/duration without AI calls.
- Both Arabic-script and Latin-script Darija coloration questions returned the correct 350 MAD price.
- Opening day, address, card payment and the 24-hour cancellation rule were answered using supplied facts.
- The model declined to invent a wedding price, student discount, or guaranteed calendar slot.
- Negated booking intent did not open a booking workflow.
- The French intake eventually completed as a request, without promising a confirmed appointment time.
- Human handoff silenced subsequent automated replies in the isolated conversation.
- The tested prompt-injection attempt did not disclose a key or change the price.
- Off-topic coding and ecommerce questions did not launch an order flow.

## Measured provider usage

| Measurement | Result |
|---|---:|
| Customer turns | 29 |
| Turns without an AI call | 12 |
| Provider calls / attempts | 17 / 17 |
| Maximum provider calls per turn | 1 |
| Provider-reported input tokens | 11,764 |
| Provider-reported cached input tokens (subset of input) | 5,888 |
| Provider-reported output tokens | 519 |
| Median elapsed time for a turn with an AI call | 874 ms |
| Range for turns with AI calls | 587–1,583 ms |

All 17 calls returned provider usage receipts. These are token measurements, not a verified monetary invoice or WhatsApp/hosting cost estimate. The short response limit caused no obvious cutoff in this sample; longer/more complex replies still need testing.

## Scoring correction and artifacts

The original transcript's simple automated checks reported 25/29. Manual review found that the wedding-price check incorrectly rejected an honest answer listing other known services; conversely, some checks accepted Latin-script French as Darija, a list of durations as successful memory, and an English prompt as a valid French booking start. The correct practical conclusion is the five issues above, affecting six turns. The reusable script's checks were strengthened after this review; the saved original transcript has not been altered or presented as a rerun.

- Raw original results: `morocco-salon-live.json`
- Readable original transcript: `morocco-salon-live.md`
- Reusable live evaluation: `scripts/evaluate-morocco-salon.ts`

## Release gate

Fix the five reproduced issues, rerun these scenarios, then verify an actual WhatsApp conversation through persistence and delivery. Test staff takeover and notifications with a real operator. Sell appointment request collection initially; automatic appointment confirmation requires a calendar/availability integration. No production chatbot logic was changed in this evaluation.
