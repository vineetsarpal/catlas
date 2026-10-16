# Catlas earthquake workbench — implementation draft

Status: testing boundaries and ten-ticket breakdown approved by Vineet. Published as implementation PRD CAT-12 and children CAT-13 through CAT-22. Implementation in progress; deployment pending verified result.

Source: [Chart the customer-testable Catlas earthquake workbench](https://linear.app/vineetsarpal/issue/CAT-1/chart-the-customer-testable-catlas-earthquake-workbench), its resolved decisions and superseding two-area amendments. Linear remains canonical; this file is a review draft. Publication should create a separate implementation parent and child issues, leaving the completed wayfinding map unchanged.

## Problem Statement

A ceded reinsurance analyst needs to explain whether an earthquake triggers existing parametric protection, how each scheduled portfolio area contributes to the treaty total, and which evidence and contract version support that provisional assessment. The analyst also needs a reviewable handoff to reinsurance operations without confusing a calculation, a delivery acknowledgement and a financial approval.

We currently have an internally reviewed throwaway prototype and resolved specification. We need a reproducible, shareable demonstration with retained history and a simulated RAS workflow. Prospective-customer usefulness and demand remain unvalidated.

## Solution

Build an interactive world-map workbench. The analyst selects an event, investigates fixed treaty trigger zones and contextual locations, explains the two area contributions and capped treaty total, reviews a versioned assessment, then downloads a packet or sends it to a simulated RAS receiver. Revised inputs require a new evaluation and review. Incomplete assessments expose their exceptions rather than asserting a recovery.

The demonstration uses public captured earthquake evidence, fictional RAS-origin contracts and synthetic locations. It runs as a static browser application and a locally served offline bundle.

## User Stories

1. As a ceded reinsurance analyst, I want to discover the demonstration earthquake on a world map or select a known scenario, so that I can begin an investigation.
2. As an analyst, I want to see the imported contract identity, source and version, so that I know which RAS-authored terms are being evaluated.
3. As an analyst, I want to distinguish the epicentre, fixed area references, contractual trigger zones and synthetic locations, so that I interpret the map correctly.
4. As an analyst, I want to inspect either scheduled area without changing the assessment, so that I can investigate both contributions safely.
5. As an analyst, I want to see the raw magnitude, occurrence time and evidence provenance, so that I can understand the assessment inputs.
6. As an analyst, I want each area's distance, matrix cell, rate, allocation and contribution explained, so that I can reproduce its result.
7. As an analyst, I want to see the uncapped sum, treaty event cap and total, so that I can explain the cedent's provisional recovery.
8. As an analyst, I want a contrasting outer-band scenario, so that I can demonstrate distance-sensitive payouts.
9. As an analyst, I want to distinguish Not triggered and Outside coverage from Needs review, so that a known zero is not confused with missing information.
10. As an analyst, I want missing or unsupported inputs identified even when another condition fails, so that I do not treat an incomplete assessment as a reliable zero.
11. As an analyst, I want to review the exact evaluation version with notes and a labelled demo identity, so that the prepared packet reflects what I inspected.
12. As an analyst, I want to download a reviewed positive or zero assessment, so that I can share the explanation independently of delivery.
13. As an analyst, I want to export an exception packet with no asserted recovery, so that operations can identify information needed to complete the assessment.
14. As an analyst, I want my evaluations, reviewed packets and delivery history retained across refresh, so that I can resume the demonstration.
15. As a presenter, I want an explicit reset separate from clearing a selection, so that I can repeat a demonstration from clean seeded state.
16. As an analyst, I want revised evidence or imported contract terms to create a new evaluation requiring fresh review, so that previous reviewed content remains trustworthy.
17. As an analyst, I want to compare the simulated M6.9 observation with the captured M7.1 reference, so that I can explain the $4m to $6m revision without implying a historical bulletin sequence.
18. As an analyst, I want to send the same reviewed content I can download, so that there is one consistent handoff.
19. As an analyst, I want receipt and rejection states with references or reasons, so that I know what the simulated receiver reports.
20. As an analyst, I want an unconfirmed delivery state and a safe status check or retry, so that an ambiguous response does not create a duplicate receiving record.
21. As an analyst, I want a freshly reviewed replacement linked to a previously sent assessment, so that a revised full amount is not treated as an additional claim.
22. As an analyst, I want to correct a previously submitted positive assessment down to zero, so that the initial-positive gate does not prevent a valid replacement.
23. As a presenter, I want the complete analytical workflow to run without external network access, so that connectivity does not interrupt the demonstration.
24. As a presenter, I want a shareable hosted link and a documented offline launcher, so that others can operate the demo themselves.
25. As an analyst, I want an operable desktop and 375px layout with clear controls and labels, so that the workflow remains usable on smaller screens.

## Implementation Decisions

### Application boundaries

- React, TypeScript and Vite; scoped CSS/CSS Modules; MapLibre GL JS; pure TypeScript/d3-geo geographic calculation; Dexie over IndexedDB; Vitest and Playwright. Pin compatible stable dependencies during implementation.
- Separate validated event/contract inputs, deterministic assessment, review/packet lifecycle, local repository and simulated delivery adapter. Use one calculated assessment for UI explanations and packet generation.
- Package versioned JSON with runtime validation. No application backend, shared database, sign-in, Dexie Cloud or real RAS connector.
- Preserve the current portfolio-treaty prototype as UX evidence. Build the agreed behavior in modular code rather than promoting its imperative implementation or illustrative provenance.
- Package fictional RAS-origin contract imports and show their source/version; Catlas does not author contracts. Corrections arrive as new imported/input versions, not payout overrides.

### Contract and assessment

- Cedent Sierra Mutual, DEMO-CEDENT-01. California Portfolio Earthquake Treaty, DEMO-CA-PARAMETRIC, imported contract v2.
- Mojave reference latitude 35.8, longitude −117.4, allocation USD 6m. Western reference latitude 35.4, longitude −118.2, allocation USD 4m. Treaty event cap USD 10m.
- UTC coverage [2019-01-01T00:00:00Z, 2020-01-01T00:00:00Z), compared with earthquake occurrence time.
- Literal raw magnitude type `mw`; no type substitution, title parsing or pre-comparison rounding. Spherical great-circle surface distance uses Earth radius 6,371 km and unrounded coordinates/results. Depth does not enter this rule.

| Raw magnitude | Inner ≤25 km | Outer >25–100 km | Outside >100 km |
| --- | --- | --- | --- |
| <6.5 | 0% | 0% | 0% |
| ≥6.5 and <7.0 | 50% | 25% | 0% |
| ≥7.0 and <7.5 | 75% | 37.5% | 0% |
| ≥7.5 | 100% | 50% | 0% |

- Each area contributes once: selected rate × allocation. Sum contributions and apply the event cap. Overlapping areas may both contribute; nested bands within one area are exclusive. Allocations are not insured values or physical losses.
- Validate all required inputs before asserting a number. Missing, ambiguous or unsupported required inputs → Needs review, amount null, even if another condition fails. Complete outside coverage → Outside coverage, $0. Complete covered zero → Not triggered, $0. Positive → Trigger met, provisional amount.
- Evaluate a single independent event with full event limit available. Preserve rule, contract and evidence versions. Input changes create a fresh evaluation; selection/camera changes do not.

### Evidence and walkthroughs

- Capture and retain actual selected USGS response/evidence bytes, capture UTC, digest, event aliases, selected origin/magnitude identifiers and selection provenance. Do not invent archive metadata or choose the newest timestamp across unrelated products.
- Candidate Ridgecrest reference: ci38457511, alias us70004bn0; 7.1 mw; latitude 35.7695, longitude −117.5993333; occurrence 2019-07-06T03:19:53.040Z. Verify against the captured source. Missing or incompatible evidence is a visible preparation problem, not permission to silently substitute data.
- Replay is a historical event evaluated from captured evidence, not a guaranteed reconstruction of what was known at occurrence time.
- Retain 18 synthetic location fixtures from the resolved fixture decision, including Lancaster, Ridgecrest, Trona and Tehachapi amendments. Location selection/grouping is context and does not create recovery conditions.

| Walkthrough | Required result |
| --- | --- |
| Captured Ridgecrest / main treaty | Mojave about 18.298 km: $4.5m; Western about 68.107 km: $1.5m; total $6m |
| Labelled synthetic M7.1 outer event | $2.25m + $1.5m = $3.75m |
| Ridgecrest / separate high-threshold variant, minimum M7.5 | Not triggered, $0 |
| Ridgecrest / separate variant missing both coverage dates | Needs review, null amount; exception export only |
| Labelled simulated M6.9 to captured M7.1 reference | $4m → $6m; fresh review; preserved earlier versions |

- Synthetic outer event: SIM-OUTER-01, latitude 35.8, longitude −118.065, explicitly synthetic occurrence 2019-07-07T12:00:00.000Z. Simulation provenance must remain distinct from historical evidence.
- Additional verification fixtures cover exact/adjacent magnitude and distance boundaries, inception/expiry, unsupported/missing inputs, known failure plus missing information, cap application and a complete downward-to-zero replacement.

### Spatial presentation

- Persistent map-led workspace with world discovery, regional focus, two area contributions and treaty-total inspector. Show both scheduled areas and allow focused inspection of either matrix.
- Use geodesic GeoJSON trigger polygons, not pixel-radius map circles. Camera, map/globe projection and rounded labels never determine a payout.
- Label rings Treaty trigger zones: where an epicentre must occur relative to a fixed reference. They are not property-coverage boundaries or damage extents. No epicentre-centred damage radius is required.
- Package permitted analytical basemap and required styles/fonts/sprites/scripts with credits. Satellite imagery is optional online context; provider rights/access must be established before adding it, and its absence cannot block acceptance.

### Review, packets and delivery

- One immutable reviewed packet per event × treaty × evaluation version. Include schema/packet/evaluation identity, cedent, RAS contract/version and terms, event/evidence provenance, rule/version, both area assessments, uncapped sum/cap/total, review metadata and provisional/historical/simulation declarations.
- Named demo analyst without sign-in. Review is version-specific and is not authenticated production financial approval. No manual payout override.
- Complete positive: reviewed download and initial send. Complete zero: reviewed download, no initial send. Incomplete: exception JSON with missing-input reasons and null recovery; recovery send blocked.
- Download and send carry the same immutable reviewed content. Delivery attempts, state and acknowledgements are separate records. Download never implies receipt.
- Simulated receiver validates the packet and supports receipt/reference, rejection/reason and unconfirmed delivery. A timeout proves neither receipt nor rejection.
- Retry/status check uses the same submission identity; the receiver deduplicates it. Changed content requires a new reviewed packet identity.
- Revisions transmit a full replacement assessment, not a delta/additive claim, linking prior packet and known receiving reference. Reconcile earlier unconfirmed delivery before sending a replacement. A complete revision to a previously sent positive may correct to zero; incomplete revisions remain blocked.

### Persistence and distribution

- Retain evaluations, immutable packets and separate delivery/mock receiver history locally across refresh. Version the storage schema and prevent silent reinterpretation of old records under new rules.
- Reset demo data returns to clean seeded state, including simulated receiving records; clearing map/workspace selection does not erase history.
- Cloudflare Pages static hosted build plus downloadable offline build with documented stable-origin local-server launcher. Hosted and local origins have separate browser data.
- Core analytical flows must run without live USGS, external scripts, imagery or RAS. Desktop current Chrome/Edge and usable responsive layout to 375px.

## Testing Decisions — approved boundaries

There is no reusable production test suite in this repository. Prototype browser checks are discussion evidence, not replacement application tests. Test observable results and state transitions, not React internals, CSS snapshots or incidental module structure.

1. **Assessment boundary:** validated event evidence and imported terms → complete assessment or explicit exceptions. Vitest covers matrix/coverage boundaries, geodesic cases, aggregation/cap and incomplete-input precedence. Keep mathematically exact-distance rule fixtures distinct from coordinate-derived floating-point cases. Assert expected values from the resolved specification rather than generating expectations using the same implementation.
2. **Reviewed packet and local history boundary:** assess → review/export → revise → reload/reset. Verify packet immutability, download-content equivalence, fresh review, preserved prior records and schema-version handling through repository/lifecycle behavior. Use real IndexedDB in browser acceptance for refresh/storage behavior.
3. **Simulated receiver boundary:** submit/check/retry/replace → observable reference/state/count. Verify rejection, lost acknowledgement, deduplication, reconciliation and downward-to-zero replacement. Tests must detect duplicate receiver records, not merely successful buttons.
4. **Browser journey boundary:** Playwright operates the workbench and checks explanations, downloaded JSON and history. Cover all five walkthroughs, area/camera selection preserving review, receipt vs download, mobile usability, refresh/reset and the offline bundle with external networking blocked. Network-dependent imagery is outside the core pass.

Each slice includes its relevant verification; testing is not postponed to a final separate phase. Visual inspection remains necessary for trigger-zone legibility and responsive layout. These internal checks do not claim external customer validation or vendor compatibility.

## Approved implementation slices

All slices below are approved and published as CAT-13 through CAT-22. AFK means implementation can proceed from the approved specification without a further product decision; it does not waive repository review or confer deployment authorization. HITL indicates an explicit human/account step.

### 1. Replay Ridgecrest and explain the two-area $6m recovery

**Type:** AFK. **Blocked by:** None. **Stories:** 1, 2, 3, 5, 6, 7, 25.

Deliver a running minimal map workbench with a packaged historical evidence archive, validated fictional RAS contract import, the two area assessments and total explanation. This includes the initial application foundation as part of a working analyst path, not a separate setup-only ticket.

Acceptance:
- Actual source bytes, capture metadata, digest and selected evidence provenance are retained and inspectable; historical/fictional labels are visible.
- Ridgecrest selects the agreed raw evidence, exact occurrence time and contract v2; both contributions and $6m total match the specification.
- Map differentiates epicentre and fixed references with visible 25/100 km geodesic trigger zones; contributions show the selected matrix cells.
- Domain assessment has no React/map/storage dependency; required scripts and analytical assets are local.
- The core selection/explanation path works on desktop and 375px; corresponding assessment and browser checks pass.

### 2. Explore world context, scheduled areas and the outer-band case

**Type:** AFK. **Blocked by:** 1. **Stories:** 1, 3, 4, 8, 25.

Deliver map discovery, regional focus, contextual locations/layer controls and area inspection with the labelled outer-band walkthrough.

Acceptance:
- All 18 amended synthetic fixtures are available; selecting them does not alter treaty reference points or amounts.
- World/regional and map/globe exploration preserves assessment inputs and clearly separates contextual layers.
- Either area can be inspected while both contributions and the treaty total remain available.
- SIM-OUTER-01 is explicitly synthetic and yields $3.75m; nested rates are not added.
- Trigger-zone labels and inner/outer boundaries remain legible at the supported viewport sizes.

### 3. Explain zero and incomplete assessments without false certainty

**Type:** AFK. **Blocked by:** 1. **Stories:** 9, 10.

Deliver the high-threshold and missing-coverage walkthroughs, with explicit validation and coverage outcomes.

Acceptance:
- High-threshold variant gives Not triggered/$0; missing coverage gives Needs review/null with reasons.
- Complete outside-coverage input gives Outside coverage/$0.
- Unsupported magnitude or missing input remains indeterminate even when a known condition fails.
- Exact/adjacent matrix, distance and coverage boundaries and event-cap behavior are verified against specified outcomes; displayed rounding cannot change them.
- The UI distinguishes indeterminate from zero and explains known failures separately from missing information.

### 4. Review an evaluation and download its immutable packet

**Type:** AFK. **Blocked by:** 1, 3. **Stories:** 11, 12, 13, 18 (content foundation).

Deliver version-specific review, notes and real JSON downloads for complete assessments and exception exports for incomplete ones.

Acceptance:
- Reviewed packet includes all canonical identity, evidence, two-area calculation, aggregation and review fields.
- Positive and zero downloads require review; incomplete export asserts no recovery and lists exceptions.
- Area/layer/camera selection cannot mutate reviewed content; substantive input changes cannot reuse it as a current review.
- Demo identity/provisional labels are explicit, and no manual payout override exists.
- JSON is runtime validated; browser tests inspect actual downloaded content, including null vs zero.

### 5. Resume retained history and reset the demonstration

**Type:** AFK. **Blocked by:** 4. **Stories:** 14, 15.

Deliver browser-local retention for evaluations, immutable packets and separate delivery records, with clean reset and version-safe reload.

Acceptance:
- Refresh and reopen on the same origin preserve prior evaluated/reviewed content without recalculating it under different rules.
- Schema/version handling does not silently reinterpret incompatible records; history is preserved or an explicit compatibility/reset path is offered.
- Reset demo data clears accumulated demo/receiver history and restores seeds; clearing a selection does not.
- Storage failures are visible rather than falsely reporting that history was retained.
- Browser acceptance uses real IndexedDB and checks both retention and reset.

### 6. Revise evidence or imported terms and require fresh review

**Type:** AFK. **Blocked by:** 5. **Stories:** 16, 17.

Deliver versioned input replacement and the M6.9→M7.1 sensitivity walkthrough, with prior results/packets retained.

Acceptance:
- Explicitly simulated M6.9 assessment yields $4m; captured M7.1 yields $6m at unchanged coordinates.
- Revised evidence or a newly imported contract version creates a new evaluation and invalidates current review eligibility.
- Old reviewed content remains immutable and inspectable after refresh; new review/export references the new inputs and prior version.
- The interface does not present the sensitivity exercise as actual USGS bulletin chronology.

### 7. Send a reviewed positive packet and inspect receipt or rejection

**Type:** AFK. **Blocked by:** 5. **Stories:** 18, 19.

Deliver analyst-initiated send to the labelled local simulated RAS receiver, with separate attempts and acknowledgements.

Acceptance:
- Submitted payload equals the downloaded reviewed content; the receiver validates the canonical packet.
- Initial positive send requires review; initial zero and incomplete recovery submissions are blocked.
- Receipt shows a mock receiving reference; rejection shows its reason. Download alone never changes delivery to received.
- Reattempting an unchanged packet uses its stable submission identity and does not duplicate a receiving record.
- Attempts/receipts persist independently without mutating the packet; all behavior works without a network service.

### 8. Recover safely from an unconfirmed delivery

**Type:** AFK. **Blocked by:** 7. **Stories:** 20.

Deliver a lost-acknowledgement scenario and usable status-check/retry recovery.

Acceptance:
- Receiver may accept while the sender sees Delivery unconfirmed; timeout is not labelled rejection or receipt.
- Check status and retry use the original submission identity and reconcile to the existing reference.
- Repeated attempts produce one receiving record; refreshed UI preserves uncertainty and attempt history until resolved.
- A payload change cannot reuse that identity as though it were an identical retry.

### 9. Send a linked replacement, including a correction to zero

**Type:** AFK. **Blocked by:** 6, 8. **Stories:** 21, 22.

Deliver revised full assessments linked to the earlier packet and receiving record.

Acceptance:
- Freshly reviewed $4m→$6m revision transmits the full $6m replacement with previous packet and existing mock receiving reference.
- Prior unconfirmed delivery must be reconciled before replacement; the flow cannot silently open an unrelated receiving record.
- A complete correction from previously submitted positive to zero is allowed; incomplete replacements remain blocked.
- Both immutable packets, reviews and delivery histories survive refresh; receiver treats the revision as replacement rather than an additive claim.

### 10. Share the completed hosted and offline demonstration

**Type:** HITL for Cloudflare account access/publication; artifact preparation and verification are AFK. **Blocked by:** 2, 3, 9. **Stories:** 23, 24, 25.

Deliver a tested static build, downloadable offline bundle and repeatable presenter instructions; publish the reviewed hosted build through the selected Cloudflare Pages account.

Acceptance:
- Offline bundle includes permitted analytical assets, credits and a documented stable-origin local-server launcher; all five walkthroughs and delivery recovery paths work with external networking blocked.
- Hosted build supports the same core behavior; hosted/local browser histories are explained as separate origins.
- Desktop Chrome/Edge and 375px flows are operable, with trigger zones and controls visually inspected.
- A short walkthrough explains event → area contributions → treaty total → review → download/send, plus revision and exception cases.
- No satellite dependency, production connector, real approval/payment or externally validated demand is implied.
- Hosting account/access and publication are handled explicitly; no credentials are embedded in the bundle. Provide a verified shareable URL after publication.

## Out of Scope

Contract creation, underwriting/pricing, PAS/RAS replacement, live event monitoring or live RAS writeback; real customer data; authenticated financial approval, accounting and payment; other perils; annual aggregates, reinstatements, consumed limits, aftershock grouping and FX; production portfolio scale, shared history and cross-device sync; mandatory satellite imagery, damage-radius or ShakeMap layers.

## Further Notes

- Customer recruitment/testing is deferred until participants are available. Preserve the future protocol from the resolved customer-test decision; internal checks do not establish usefulness, demand or willingness to pay.
- This draft retains the agreed stack. Optional imagery and offline asset selection must respect provider licenses without becoming a new core product requirement.
- After approval of testing seams and slice granularity/dependencies/types, publish a new implementation PRD in Linear Backlog and the approved slices in dependency order with native parent/blocking relations. AFK slices use ready-for-agent; the publication/account step uses ready-for-human. Link to the completed decision map without modifying or reopening it.
