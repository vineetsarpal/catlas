# Simplified event recovery

Recovery opens an event loss assessment by default (`/?mode=recovery`). From Exposure, choose **Assess event recovery** to retain the selected event. Alternatively, choose an event through **Change event**, or load the historical Ridgecrest earthquake in Recovery. The loss estimate and reinsurance terms are manually entered; no claim or reserve balances are inferred from insured values or shaking intensity.

## Workspace layout

Use the left **Assessment** tab for event inputs, loss estimates and terms, and **History** for retained assessments and packets. The left **Layers** tab controls the map’s treaty trigger zones or insured locations and shaking overlay, depending on the recovery type. **Appearance** stays on the map. The right **Details** panel contains the calculation explanation, selected contractual area, review and delivery actions. Selecting an insured location on the shared map shows its location context on the right; **Show recovery explanation** returns to the assessment. Inputs remain mounted when changing tabs. On mobile, only one side panel is open at a time; the map remains behind the drawer.

## First release workflow

1. Identify the insurer/legal entity, business line or covered portfolio, loss estimate source and valuation date.
2. Enter an estimated ultimate event loss eligible for the selected layer. This amount includes paid and outstanding loss; it is not the outstanding reserve alone. Apply underlying insurance coverage, relevant expenses and any preceding reinsurance before entering it. Do not sum overlapping early catastrophe estimates and reported claims.
3. Enter one catastrophe occurrence excess-of-loss layer: contract/version reference, first and last covered UTC dates (inclusive), retention, original layer limit, remaining available limit and placed share. All amounts must use the assessment currency (USD, CAD, EUR or GBP). Limits are at 100% before placement share; no FX conversion is performed.
4. Confirm covered business, peril, contractual occurrence grouping, expenses, preceding reinsurance and available capacity have been checked externally. Catlas does not interpret treaty wording or decide which underlying claims qualify.
5. Calculate the provisional recovery and inspect the explanation. For an event within the entered coverage dates:

   `recovery = min(max(eligible loss − retention, 0), layer limit, remaining available limit) × placed share`

   Recovery is rounded to currency cents. Estimated retained loss is eligible loss less this layer's recovery. Outside the entered dates, this layer contributes zero with an explicit outside-coverage explanation. Missing or invalid required inputs produce no result.
6. Add optional review notes, confirm review and save a reviewed version. Download that exact version as JSON for handoff. Inputs changing invalidates the current calculation and review. Saving again creates a new immutable version for the same event ID, entity, covered portfolio, contract reference and currency; changing those identities starts a separate series.
7. Reopen reviewed assessments from **Recovery history**, including after reload. Opening restores the original event observation and entered loss/term snapshot. Source/evidence changes do not silently recalculate a saved assessment.

## Boundaries and future extension

The result is an estimated ultimate recovery, distinct from booked ceded recoverables, amounts currently billable and cash collected. Retained loss describes the entered loss and this one layer, not the insurer's final net position across its whole reinsurance programme.

This release does not establish homeowner claim entitlements, calculate reserves, import claims automatically, allocate IBNR to assets, interpret hours clauses, calculate multiple/inuring layers, reinstate protection, execute notifications, book receivables or collect payments. The reviewed JSON is a manual handoff artifact; it is not a submitted notice or acknowledgement.

Snapshots are stored separately in the browser's IndexedDB database `catlas-event-recovery-1`. They retain the event observation, entered position, calculation result, review notes and review timestamp. Reload does not restore unsaved drafts or automatically open a saved version. Storage is specific to the browser and URL origin; download reviewed assessments to retain portable copies. This release exports JSON but does not import it. Local storage failures preserve records and prevent claiming a successful save. Review records an analyst confirmation, not an authenticated approver identity or financial approval.

The domain calculation, local repository and UI live in `frontend/src/recovery/`. Future claims/reserving and RAS adapters can supply loss snapshots and terms to this boundary without making Catlas their accounting system of record.

## Parametric demonstration

Choose **Parametric demonstration** under **Assessment type**, or open `/?mode=recovery&recovery=parametric`, to use the existing fictional RAS contracts, trigger zones, reviewed packets and simulated delivery. Parametric and event-loss assessments keep separate histories and calculation rules. Switching assessment type discards the unsaved form for that type; save reviewed work first.

## Verification

Validated on 2026-10-20:

- Workspace type checks and production/offline builds passed (the existing large-bundle warning remains).
- 165 frontend tests, two shared tests and five backend tests passed; one optional exposure diagnostic remained skipped. The frontend run includes 21 new recovery calculation/validation checks.
- All 54 existing Recovery and shared-workspace desktop/mobile browser regressions passed using the explicit parametric route.
- All 12 extracted offline acceptance checks passed with external requests blocked.
- The new flow was exercised in Chrome: $20m eligible loss against $15m excess of $10m produced $10m recovery; review/save/export succeeded; changing loss to $25m cleared the calculation/review and produced a fresh $15m reviewed recovery as v2. Reload and reopening v1/v2 restored their original inputs and results. Changing the selected event cleared the prior assessment. At 375px, the result and summary fit without horizontal overflow or overlapping summary values. Local screenshots: `output/playwright/simple-recovery-desktop.png` and `output/playwright/simple-recovery-mobile.png`.

The new form's browser checks were interactive verification; the calculation/validation checks are retained unit tests. No live claims, reserving or RAS integration was exercised.
