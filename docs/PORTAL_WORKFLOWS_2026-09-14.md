# Plan publication and workflow editor fix — 14 September 2026

Selecting an assigned plan used to change only the dropdown. The Publish data button sent only the account revision, so publication failed with PLAN_REQUIRED unless Save controls had been clicked separately.

The account page now identifies pending changes and offers **Save & publish data**. The server validates and saves the selected plan and changed controls, then publishes the business data within the same database transaction. A failed publication rolls back those changes. Revision conflict checks, administrator authorization, CSRF protection, plan limits and activation requirements remain in place.

## Using the account page

1. Open Admin → Clients → the account.
2. Under Overview, select the assigned plan.
3. Click Save & publish data. The page confirms publication and shows the saved plan.
4. Use Workflows & intents to configure conversation steps and intent routing. Save controls saves those settings; Save & publish data also publishes the current business data.
5. Link WhatsApp before changing the account status to ACTIVE. Publication alone does not activate WhatsApp.

## Restored workflow controls

The dedicated Workflows & intents section includes workflow creation, duplication, templates, activation phrases and intents, manual start, interruption and execution limits. It supports choice, collect, confirm, message, knowledge, handoff and end steps, with English, French, Arabic and Darija prompts; collection field types and validation; confirmation and cancellation phrases; direct and conditional transitions; and custom intent routing.

The flow diagram selects steps for editing and shows their paths. Steps appear from the starting step even when database JSON keys are reordered. Validation reports missing targets and unreachable steps. Renaming a step updates its references; deleting a referenced step or an intent used by a conditional transition is blocked until its references are updated. Advanced JSON remains available and existing extra configuration is preserved.

## Verification

- Targeted API, session, configuration, local testing and workflow tests: 45 unique tests passed (43 in the initial targeted run, then 10 workflow tests including two new regressions).
- Production TypeScript build passed.
- Browser verification used an isolated in-memory database, with no changes to real client data and no WhatsApp, email or paid provider calls.
- Confirmed direct publication after choosing a previously unassigned plan, saved French and Darija prompts, custom intent mapping, branch label persistence, reload persistence and clickable diagram selection.
- Checked desktop and 390px-wide mobile layouts. Mobile document width equals its viewport width; the diagram scrolls within its own panel. No browser warning or error logs were captured.
- Live WhatsApp delivery and provider-generated responses were not exercised by these checks.

## Rollback

The snapshot at `output/rollback/portal-workflow-20260914` contains the pre-change files and SHA-256 checks for this fix only. Run `rollback.ps1` without arguments to validate it; `-Apply` restores the snapshot and rebuilds. Restart the app after applying a rollback. The script refuses to overwrite files changed since the snapshot was finalized.
