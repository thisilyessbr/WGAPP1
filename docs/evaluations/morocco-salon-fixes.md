# Moroccan salon fixes and verification

24 September 2026. The five reproduced issues were corrected locally and the live salon evaluation rerun. This is evidence for the evaluated engine behavior, not a production deployment or a WhatsApp delivery certification.

## Changes and observed results

| Issue | Fix | Live result |
|---|---|---|
| Darija price question answered in French | Extended deterministic language recognition with common Darija price spellings | `bchhal brushing?` → `Brushing b 80 dh, kayakhod 30 d9i9a.` No AI call. |
| Combined question lost closing time | Added a multilingual FAQ coverage guard for price, duration, hours, address and payment; incomplete matches proceed to grounded generation | Answer contains 80 MAD, 30 minutes and closing at 19:00. One AI call. |
| Follow-up lost the selected service | Supply the last two conversation messages for follow-ups only, at most 600 content characters, labelled as untrusted reference context; current business facts remain authoritative | After coloration pricing, `Et ça dure combien de temps ?` → `La coloration dure 90 minutes.` One AI call. |
| French booking flow started in English | Recognize short French booking wording so numeric choices inherit the correct language | `Quel service souhaitez-vous ?` followed by `Votre nom, s’il vous plaît ?` No AI calls for these two turns. |
| Natural Darija cancellation ignored | Allow bounded polite framing around explicit cancellation commands; exclude policy questions, negations and conditional requests | `safi bghit nlghi` → `t-anulat l-3amaliya.` Session marked CANCELLED, no AI call. |

Grounded answer instructions also distinguish guidance from performed actions. The tested request to confirm tomorrow at 15:00 now explains that staff must record/confirm it, without saying the bot has confirmed or will automatically register an appointment.

## Verification

- All 29 customer turns passed the strengthened rule checks in the real DeepSeek rerun. The transcript was also reviewed for the original failures. This is a small sample, not a statistical accuracy claim.
- 318 focused automated tests passed across 10 suites, including 28 new salon regressions, language handling, FAQ coverage, conversation context, cancellation/negation, workflow collection, handoff and provider cost controls.
- Production build, TypeScript compilation and whitespace checks passed.
- The evaluation memory adapter now returns messages newest-first, matching the actual ConversationService contract. The original report remains preserved separately.

## Cost and latency

| Measurement | Before | After |
|---|---:|---:|
| Customer turns | 29 | 29 |
| AI calls | 17 | 17 |
| Maximum calls per turn | 1 | 1 |
| Turns without an AI call | 12 | 12 |
| Input tokens | 11,764 | 12,920 |
| Cached input tokens (subset of input) | 5,888 | 6,528 |
| Output tokens | 519 | 624 |
| Median elapsed time for AI turns | 874 ms | 931 ms |

The Darija FAQ now saves a call; the previously incomplete combined question now uses a call to answer every part. Total call count stays the same. Input token usage rose about 9.8% because of reference context and clearer instructions; output usage also rose as answers became more complete. These are provider-reported tokens, not a monetary invoice. No extra model or embedding provider was introduced.

## Limits and next gate

Real engine and DeepSeek were exercised with fictional business facts and isolated memory persistence. No live client settings were edited. Changes have not been deployed. Document retrieval, production database writes, WhatsApp transport, real staff notifications and calendar availability were not tested here. A connected WhatsApp test with actual staff takeover remains necessary before an unattended paid launch. Darija generation still contains some French code-switching; broader merchant review remains useful.

Original review: `morocco-salon-review.md`. Corrected transcript: `morocco-salon-after-fixes.md`. Provider receipts and routes: `morocco-salon-after-fixes.json`. Reproduce with `npx tsx scripts/evaluate-morocco-salon.ts`; it uses the locally configured DeepSeek key, incurs a small number of API calls, and exits unsuccessfully on failed checks.
