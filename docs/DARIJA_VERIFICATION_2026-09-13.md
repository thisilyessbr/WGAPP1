# Darija verification and fixes — 13 September 2026

The chatbot's Darija routing and deterministic response paths were tested and improved locally. The same 140-case suite passed **77 cases before these changes and 140 afterward**. The complete selected database-independent unit suite passed **680/680 tests**. Type checking, TypeScript compilation and the normal Git whitespace check passed.

This is regression coverage, not a guarantee that every possible Darija sentence or generated answer is perfect. The tests use simulated persistence, catalog facts and AI responses. No production deployment, live customer messages, live database changes or paid AI requests were made.

## What was fixed

| Area | Behavior now covered |
| --- | --- |
| Spelling and language | Arabic script, Arabizi, number spellings, stretched words, Arabic diacritics and mixed French/Darija. Examples include `slm`, `salaam`, `baghya ncommandi`, `ch7al livraison?` and `واش livraison gratuite؟`. Known language words are normalized while product names and SKUs are preserved. |
| Refusals | `ma bghit ch nchri hada`, `machi baghi nchri hada`, `ما بغيتش ناخد هادشي` and final corrections such as `bghit nchri? la mabghitch` do not authorize purchase or create a CRM lead. Negation is bounded by clauses. |
| Human support | Natural variants such as `bghit nhdar m3a chi wa7d`, `بغيت نهدر مع شي واحد`, `بغيت نهضر مع مول المحل` and `دوزني لشي مسؤول` are recognized. Refused handoffs remain blocked. |
| Script continuity | Greetings, handoff acknowledgments, fallbacks, supported workflow prompts, attachment failures and conversation-limit messages respect Arabic versus Latin Darija. Short replies such as `42`, `M`, `ok`, `نعم` and `لا` inherit the conversation language and script. A clear language change still switches language. |
| Policies | Shipping, returns, tracking, warranty, payment, care and store information have Darija cases. Arabic-script evidence is no longer rejected because of English-only regular-expression word boundaries. `fransa` and `lfransa` are recognized as France, preventing a domestic shipping fee from answering that destination. |
| Shopping | Full engine tests preserve the authoritative catalog price and currency in both scripts. Positive purchase, recommendation/search distinctions, product names and SKUs remain covered by the combined suites. |
| Workflow confirmation | `ih`, `iyeh`, `wakha!`, `واخا!`, `إيه` and `اه` confirm in a confirmation state. Qualified statements such as `wakha walakin bdel l3onwan` do not automatically confirm. Direct refusals cancel the active workflow. |

Two older tests were updated for the intended script behavior: one expected Arabic text despite explicitly requesting Arabizi; the multilingual booking test now supplies translated workflow prompts and checks the corresponding replies.

## Custom workflow and business prompts

To retain exact business wording in both scripts, configure explicit variants:

```json
{
  "darija_arabic": "عفاك شنو سميتك الكاملة؟",
  "darija_arabizi": "3afak chno smitek kamla?"
}
```

An existing `darija` entry is used when its script matches. If it does not match, supported deterministic prompt paths use a localized generic fallback. They do not invent a translation of arbitrary business instructions. Review tenant-specific prompts, option labels, product descriptions and knowledge documents for natural wording and adequate facts in the desired language.

## Evidence

- `tests/unit/darija-conversation.spec.ts`: 140 regression cases, including full conversation-engine and workflow paths with simulated dependencies.
- `output/darija-verification/full-baseline.json`: 77/140 against saved pre-Darija source snapshots. The comparison did not restore or modify working files.
- `output/darija-verification/unit-results.json`: final 680/680 result, including the 140 Darija cases.
- `output/darija-verification/baseline.config.mjs`: source-snapshot comparison configuration.

## Rollback

This batch has a separate backup in `output/rollback/darija-fixes-20260913`. It preserves all changes from the previous chatbot fix batch.

Verify without changing anything:

```powershell
& './output/rollback/darija-fixes-20260913/rollback.ps1'
```

Restore only this Darija batch and rebuild:

```powershell
& './output/rollback/darija-fixes-20260913/rollback.ps1' -Apply
```

The script validates all current-file and backup hashes before making changes. If later work changed an affected file, it stops rather than overwriting it. No rollback has been applied.

## Remaining validation boundary

Live model fluency, factual retrieval over actual tenant documents, real WhatsApp delivery, audio understanding and dialect/spelling forms outside this authored corpus were not validated by these offline checks. The useful next acceptance step is a staging conversation set using the actual tenant prompts and knowledge, reviewed by a Moroccan Darija speaker. The code remains heuristic; ambiguous or unfamiliar language must still receive clarification instead of an assumed transaction.
