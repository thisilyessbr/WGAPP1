# Moroccan conversational retest — 2026-09-24

## Scope and results

Ran 120 everyday Moroccan WhatsApp-style questions against the real `ConversationEngine` and live DeepSeek across 10 fictional businesses: clothing, electronics, salon, restaurant, riad, school, garage, property, clinic, and grocery. The set includes Darija Arabic script, Arabizi, mixed language, price, hours, address, payment, delivery, unsupported student discounts, booking confirmation, cross-account products, two-part questions, and two-turn follow-ups.

The final full run's automatic checker reported **115/120**. Manual transcript review found **two valid discount answers rejected by the checker** (restaurant and grocery), giving **117/120 substantively correct in that run**. The remaining three failures were incomplete combined answers: electronics price + hours and property/clinic location + hours. After the code fix, those three cases each passed a targeted live rerun. A separate two-case live rerun confirmed the booking replies no longer expose internal workflow terminology. This is **not** a claim of a fresh 120/120 full-suite pass after the final edits.

The final full run used 77 LLM calls, approximately 50,715 input tokens and 3,178 output tokens, with 1,338 ms p95 turn latency in this fictional in-memory setup. See [full transcript](moroccan-120.md) and [machine-readable turns](moroccan-120.json). The checker is a triage aid, not a semantic judge.

## Issues fixed during this exercise

- Arabizi store-address questions no longer get mistaken for product searches or answered with an unsupported “I don't know.” The configured account address is used directly for a narrow location question.
- Store-wide student discount questions no longer enter the product-search path. When no discount is published, the bot states that it has no information instead of declaring a discount impossible.
- Combined questions retain the configured closing hours as well as price or location. A narrow address shortcut no longer swallows a second hours question.
- The live evaluator now recognizes common Arabizi variants such as `ma kaynach`, `msdodin`, `juj yum`, and `6:00 d l3chiya` without labeling correct answers as failures.
- The grounded-generation instruction asks for brief customer-facing answers and avoids exposing internal workflow terms.

## Release interpretation

This is evidence that the fictional text-answer path handles these 120 cases reasonably well. It does **not** validate actual merchant content, uploaded PDF extraction and retrieval, persistent database state, WhatsApp delivery, appointment workflows, phone-number setup, or production load. Before marketing, test a real merchant's published information and PDF documents through the actual inbox/WhatsApp path, and inspect the replies for Arabic/Darija naturalness and action accuracy.
