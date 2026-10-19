# Canonical implementation decision sources

Retrieved from Linear for this implementation. Linear remains canonical. Superseding amendments take precedence over earlier resolutions. CAT-1 is unchanged.

## Archived visual prototypes

The obsolete `prototypes/catlas-visual/` directory has been removed from the active tree. Historical paths in the retrieved resolutions below refer to Git history, not runnable application files. The final prototype files and their README remain available at [commit `5f16013`](https://github.com/vineetsarpal/catlas/tree/5f16013b98022bf5803d8346f8c6391b99953e06/prototypes/catlas-visual), including the [portfolio-treaty prototype](https://github.com/vineetsarpal/catlas/blob/5f16013b98022bf5803d8346f8c6391b99953e06/prototypes/catlas-visual/portfolio-treaty.html). Earlier commit references below identify the versions used for each decision.

## CAT-2: Define the analyst journey and Catlas's authority

https://linear.app/vineetsarpal/issue/CAT-2/define-the-analyst-journey-and-catlass-authority

### Comment c9b328ca-8242-4beb-959d-3bdcf2526e62 (2026-10-15T18:25:23.709Z)

## Resolution — agreed with Vineet, 15 October 2026

Vineet accepted the integration direction and then all three final journey recommendations (“lets go with recommendations”).

### Bounded analyst journey
1. Open a persistent world-map workspace with relevant earthquake events. Support both discovering an event and investigating a known event; no recovery is selected merely by opening the workspace.
2. Select an event to inspect its evidence and compare contractual outcomes. Portfolio context is distinct from physical loss and contractual payout.
3. Select a reinsurance contract to trace the provisional recovery to the imported contract version and event evidence. Contract authorship and maintenance belong in RAS; Catlas pulls relevant terms rather than creating contracts.
4. Review the explanation for that evaluation version. An evidence or contract revision produces a new evaluation requiring fresh review; preserve previous packets and delivery history. Subsequent delivery identifies the packet as a revision.
5. For a complete assessment, download the reviewed packet as JSON or initiate delivery to RAS. Prefer outbound sending; allow RAS collection if required by its interface. Show pending delivery/collection, acknowledgement and receiving reference, or failure with retry. Repeated delivery attempts must not create duplicate receiving records.
6. For missing required information, show Needs review, assert no numeric recovery, and block recovery submission. Allow a separate exception JSON download describing the missing information.

### Authority boundary
Catlas calculates and explains a provisional contractual recovery and prepares an analyst-reviewed handoff. Review is confirmation of the explanation for a particular evaluation version. RAS receipt does not imply financial approval or payment. Contract record authority, receiving record classification, approval, accounting and payment remain downstream.

### Observable acceptance conditions
- Discovery and known-event investigation both lead to an identifiable event, contract and evidence-based explanation.
- The analyst can distinguish a provisional recovery, unmet trigger and incomplete assessment.
- Each reviewed packet identifies its contract/evidence versions; changed inputs require fresh review without losing prior history.
- Complete reviewed packets have download and delivery routes; incomplete assessments have exception download but no recovery submission.
- Delivery status and receiving reference are distinguishable from approval/payment.

### Remaining decisions and assets
Detailed treaty rules, replay fixtures, target RAS naming/schema, integration fidelity and final layout validation remain in their existing decision tickets. Live RAS writeback remains outside this planning effort; the specification includes delivery behaviour, and demonstration fidelity remains to be decided.

Discussion source: combined prototype on `codex/catlas-visual-prototype`, commit `7b361c2`, `prototypes/catlas-visual/combined.html`; indexed under Test the workbench layout and explanation flow. Prototype behaviours are not automatically approved beyond this resolution. Canonical terms captured in root `CONTEXT.md`.

### Comment 508cde79-267b-41c3-8172-0784dea40cd2 (2026-10-12T18:36:57.997Z)

Enterprise UX research is complete and its resolution is indexed on the map. Observed EigenPrism and ExposureIQ screens support persistent maps with adjacent controls/results, but do not settle the entry order. Touchstone documentation also illustrates event-table-driven map analysis. Revisit the prior event-first recommendation with Vineet; it has not been accepted. The interactive world-map direction remains the starting point, with map-dominant, balanced map/results, and multiple entry routes as options for discussion.

## CAT-3: Establish USGS evidence and historical replay constraints

https://linear.app/vineetsarpal/issue/CAT-3/establish-usgs-evidence-and-historical-replay-constraints

### Comment 97ab8725-a326-433a-ac5d-0b220c0513ce (2026-10-12T18:17:24.644Z)

## Resolution — USGS evidence supports a frozen historical replay

Official [GeoJSON summary](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) and [detail](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson_detail.php) provide the event and contributed products. Product versions have source/type/code/updateTime identities; preferred means highest preferredWeight, breaking ties by newest updateTime. The newest product across contributors is not necessarily preferred. [Product semantics](https://earthquake.usgs.gov/data/comcat/products.php).

The [catalog API](https://earthquake.usgs.gov/fdsnws/event/1/) supports historical events and event-specific `includesuperseded=true` access to retained revisions/deletions. It does not document a complete catalog-as-of reconstruction: occurrence-time filters and updated-after queries do not supply that guarantee. Product creation time also cannot establish when Catlas observed it. Freeze evidence bytes, retrieval time, selection policy and hashes; freeze treaty, synthetic portfolio and calculation versions alongside them. Treat a current historical snapshot, replay of retained revisions and operationally captured snapshots as different modes.

Magnitude/location can change as information improves. [USGS revision explanation](https://www.usgs.gov/faqs/whywhen-does-usgs-update-magnitude-earthquake?items_per_page=6&page=0). Retain raw magnitude/type and coordinates, origin time, event update time, product time and retrieval time separately; reviewed status is evidence of human review, not contractual finality.

Two candidate responses verified on 2026-10-12:
- [Ridgecrest](https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=ci38457511&includesuperseded=true): ci38457511, M7.1 mw, origin 2019-07-06T03:19:53.040Z, 18 origin and 45 ShakeMap objects.
- [South Napa](https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=nc72282711&includesuperseded=true): nc72282711, raw mag **6.02 mw** although title displays **M6.0**, origin 2014-08-24T10:20:44.070Z, 42 origin and 38 ShakeMap objects.

Counts include retained revisions and contributors, not independent events. Both reported reviewed and multiple aliases. Current preferred ShakeMaps included later Atlas contributions, reinforcing that current preference is not original operational availability. Candidate data are retrieval observations; download validation and a frozen fixture remain future work.

A magnitude-and-epicentral-distance rule does not require ShakeMap. Rings depict distance, not shaking/damage/loss. [ShakeMap](https://earthquake.usgs.gov/data/shakemap/) depicts ground motion/intensity; keep any such overlay versioned and separately labelled. [USGS credit guidance](https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted) asks acknowledgement; check third-party asset notices.

**Downstream decisions remain open:** event/geography and replay mode; magnitude authority/type, raw versus rounded comparisons, distance definition, boundaries and revision/finality policy. These belong in the existing scenario and fictional treaty decisions. This research selects none of them.

**Research asset:** `docs.local/work/usgs-replay-evidence.md`, copied to `/Volumes/CrucialBX500SSD/code/catlas/docs.local/work/usgs-replay-evidence.md`.
**Isolated worktree:** `/private/tmp/catlas-research-usgs`.
**Branch/commit:** `research/usgs-replay` at `8773c73c8ec734a09b307c7772173dbf905c5184` (local, not pushed).

Scope answered with documented constraints; this does not establish exhaustive history, validated downloadable overlays, contractual authority or production availability.

### Comment 7b9a9273-f632-4945-b165-578b5eb8e6b6 (2026-10-12T18:14:28.308Z)

Research claimed for Vineet and dispatched to a background agent. Findings are being captured on the isolated local branch `research/usgs-replay` in `/private/tmp/catlas-research-usgs`, with the planned asset `docs.local/work/usgs-replay-evidence.md`. The resolution will include official source links and a commit pointer; human scenario and treaty choices remain open.

## CAT-4: Choose the fictional treaty rules and recovery semantics

https://linear.app/vineetsarpal/issue/CAT-4/choose-the-fictional-treaty-rules-and-recovery-semantics

### Comment 10899376-711b-462c-b520-3fa15b937f2b (2026-10-15T19:53:45.315Z)

## Superseding resolution — two-area cedent treaty, accepted 15 October 2026

Vineet accepted the proposed replacement story (“lets do that”): a fictional cedent insurer buys one parametric reinsurance treaty protecting two scheduled portfolio areas. This supersedes the earlier single-reference/three-main-treaty assumptions; other evidence, UTC coverage, distance/boundary, incomplete-input precedence and review/version rules remain unchanged.

Cedent: Sierra Mutual (fictional). Main contract: California Portfolio Earthquake Treaty, `DEMO-CA-PARAMETRIC`, imported from simulated RAS, version 2. Scheduled Mojave area has reference latitude 35.8 / longitude −117.4 and $6m payout allocation; scheduled Western area has reference latitude 35.4 / longitude −118.2 and $4m allocation. Apply the previously resolved magnitude × exclusive distance-band matrix to each area independently. Each area contributes once. Add area contributions, then apply the $10m USD treaty event cap. Overlapping area circles may both contribute under this explicit fictional aggregation rule; do not add nested-band rates within an area.

Allocations are contractual maximum contributions, not insured values or property loss estimates. Payout is a provisional recovery for the cedent, not individual policyholder claim payments. Portfolio site markers remain contextual rather than additional trigger conditions.

Ridgecrest M7.1: Mojave 18.298 km →75%×$6m=$4.5m; Western 68.107 km →37.5%×$4m=$1.5m; sum $6m, under $10m cap. Simulated outer event: both areas in outer band →$2.25m+$1.5m=$3.75m. Labelled simulated M6.9 observation at Ridgecrest coordinates →$3m+$1m=$4m; reference M7.1 →$6m, requiring fresh review.

The unmet-trigger and missing-coverage walkthroughs are now separate fictional versions/variants of this two-area structure (`DEMO-CA-HIGH-THRESHOLD`, minimum M7.5; `DEMO-CA-INCOMPLETE`, missing coverage), not the earlier three main contracts. All use explicit fictional terms; public parametric examples motivate the structure but do not validate our bespoke allocations or aggregation wording.

New discussion asset: `codex/catlas-visual-prototype`, commit `ac18828`, `prototypes/catlas-visual/portfolio-treaty.html` and embedded `portfolio-flow.js`. Area selection changes presentation only; event/contract/evidence changes create evaluations. Browser checks verified totals, aggregation/cap, exception/zero gates, revision linkage and stable reviewed content on area selection. Live usability verdict remains with Test the workbench layout and explanation flow. Glossary updated in root CONTEXT.md.

### Comment d11e010c-9c5f-4965-a199-44d02308b1b6 (2026-10-15T18:50:16.076Z)

## Resolution — confirmed with Vineet, 15 October 2026

Vineet accepted the proposed trigger/matrix/scope, confirmed evidence/coverage/distance rules, and confirmed the contrasting treaties and incomplete-input precedence. These are fictional demonstration contract conventions, not universal insurance rules or validated real contract terms.

### Contract model and scope
RAS owns contract creation and maintenance. Catlas evaluates a versioned import. Each demonstration treaty has one fixed contractual reference point, a USD per-event limit, a coverage interval, a magnitude/distance payout schedule and an explicit evidence requirement. Synthetic insured locations are contextual; they are not separate payout-generating inputs. Rings are contractual distance bands, not shaking footprints.

Evaluate one earthquake independently, assuming the full per-event limit is available. Exclude aftershock/event grouping, annual aggregates, reinstatements and previous limit consumption from this first specification.

### Main payout matrix
Exclusive distance columns: inner ≤25 km; outer >25–100 km; outside >100 km.

| Raw magnitude (`mw`) | Inner | Outer | Outside |
| --- | --- | --- | --- |
| <6.5 | 0% | 0% | 0% |
| ≥6.5 and <7.0 | 50% | 25% | 0% |
| ≥7.0 and <7.5 | 75% | 37.5% | 0% |
| ≥7.5 | 100% | 50% | 0% |

Select one cell; do not sum nested bands. For a complete, in-coverage assessment, provisional recovery = matched rate × contract limit. Values are USD; there is no FX conversion in this scope.

### Contrasting fictional treaties
- Pacific Quake A: main matrix; $10m limit.
- Western Quake B: same distance bands, zero below M7.5; at ≥7.5 retain the main matrix rates; $8m limit.
- Regional Quake C: main matrix; $4m limit; intentionally missing coverage dates to demonstrate Needs review.

Exact reference coordinates and coverage fixture dates belong in Select the earthquake replay and synthetic portfolio fixtures.

### Evidence and arithmetic
Use a frozen USGS snapshot preserving selected raw magnitude, magnitude type, epicentre and source identifiers. Require literal `mw` in the demonstration; no rounded-title parsing or silent substitution of other types. Document the actual selected source observations and selection provenance with the replay bundle. Missing, unsupported or ambiguous required evidence is indeterminate. Never present a synthetic revision as a historical USGS bulletin.

Use spherical great-circle epicentral surface distance, Earth radius 6,371 km, and unrounded coordinates/results for threshold comparisons. Depth does not enter this distance. Display rounding must not change the result. Magnitude lower thresholds are inclusive. Exactly 25 km is inner; exactly 100 km is outer.

Coverage compares earthquake occurrence time in UTC with [inception, expiry): inception included, expiry excluded. Do not substitute evidence publication, retrieval or evaluation time.

### Result precedence and analyst authority
Validate all required evidence and contract inputs before asserting a numeric result. Missing or ambiguous required inputs → Needs review (indeterminate), no amount, even if another known condition suggests zero. Show the known failed condition and missing information separately.

With complete supported inputs: outside coverage → Outside coverage ($0); otherwise a zero matrix rate → Not triggered ($0); otherwise → Trigger met with provisional recovery. An incomplete assessment permits exception JSON download and blocks recovery submission, as agreed in Define the analyst journey and Catlas's authority.

Analysts may annotate or correct imported data through a new version, but cannot manually override the calculated amount. Changed evidence or contract inputs require a new evaluation and fresh review; retain old packets and delivery history.

### Examples and required edge cases
- M7.1 at 18.3 km, Pacific A, complete coverage → 75% × $10m = $7.5m.
- M7.1 at 60 km, Pacific A → 37.5% × $10m = $3.75m.
- M7.1 within 100 km, Western B → $0, Not triggered.
- Missing Regional C coverage dates → Needs review, no amount.
- Exactly M6.5/M7.0/M7.5 select the higher magnitude row; no display rounding before comparison.
- Exactly 25/100 km select inner/outer respectively; just beyond 100 km selects outside.
- Exactly inception is included; exactly expiry gives Outside coverage ($0) when other required inputs are complete.
- A known failed trigger plus missing coverage remains indeterminate.
- Unsupported magnitude type remains indeterminate, with no implicit conversion.

### Follow-on work and sources
Select the earthquake replay and synthetic portfolio fixtures will freeze event/evidence, coordinates, dates and contrasting scenarios. Define the provisional recovery handoff to RAS will establish field mapping and delivery semantics. Final layout validation remains under Test the workbench layout and explanation flow.

Discussion assets: combined prototype branch `codex/catlas-visual-prototype`, commit `7b361c2`, `prototypes/catlas-visual/combined.html`; preceding Map Canvas branch `prototype/map-workbench`, commit `86a76e8`. Existing prototypes may diverge from these now-agreed rules and are not automatically updated by this planning resolution. Research prerequisite: Establish USGS evidence and historical replay constraints. Domain terms captured in root `CONTEXT.md`.

### Comment 8608a415-dfc7-4b59-a76f-c54aaba847a6 (2026-10-15T18:28:57.280Z)

First live round accepted by Vineet: “lets go with recommendations”.

Agreed for the fictional main demonstration treaty:
- Trigger uses earthquake magnitude and surface distance from the epicentre to one fixed contractual reference point. Synthetic insured locations remain contextual, not separate payout-generating inputs.
- Exclusive magnitude × distance schedule: below 6.5 → 0/0/0%; 6.5–<7.0 → 50/25/0%; 7.0–<7.5 → 75/37.5/0%; ≥7.5 → 100/50/0%, for inner ≤25 km, outer >25–100 km, outside >100 km respectively. One matched cell, no addition of nested-band rates.
- Main treaty limit is $10m USD per event. Contrasting fictional treaties may test other outcomes; their exact fixtures remain to be settled.
- Evaluate one earthquake independently with the full limit assumed available. Aftershock/event grouping, annual aggregates, reinstatements and prior-limit consumption are outside this first specification.

Still open: authoritative snapshot/magnitude selection, coverage period and time operators, distance method/precision, contrasting contract cases and explicit indeterminate handling. Continuing the same decision ticket; no resolution yet.

## CAT-5: Select the earthquake replay and synthetic portfolio fixtures

https://linear.app/vineetsarpal/issue/CAT-5/select-the-earthquake-replay-and-synthetic-portfolio-fixtures

### Comment 271087e3-de26-4865-b4e4-b7a3f287fea6 (2026-10-15T19:53:53.950Z)

## Fixture amendment following accepted two-area treaty design

Supersedes the earlier three-main-contract fixture set. Use fictional cedent Sierra Mutual and one `DEMO-CA-PARAMETRIC` contract v2. Mojave reference (latitude 35.8, longitude −117.4) has $6m allocation; Western (35.4, −118.2) has $4m. Coverage remains [2019-01-01T00:00:00Z, 2020-01-01T00:00:00Z); treaty event cap $10m. High-threshold and missing-coverage scenarios use separate clearly labelled fictional contract variants of the same two-area schedule.

Updated main expected totals: Ridgecrest $4.5m+$1.5m=$6m; simulated outer-band event $2.25m+$1.5m=$3.75m; high-threshold variant $0; missing coverage indeterminate/no amount; simulated M6.9→reference M7.1 changes $4m→$6m. Historical source metadata and simulation provenance remain unchanged.

Keep 18 synthetic locations, with four amended contextual sites: DEMO-LOC-03 Lancaster (longitude −118.14, latitude 34.70); DEMO-LOC-06 Ridgecrest (−117.67,35.62); DEMO-LOC-07 Trona (−117.37,35.76); DEMO-LOC-08 Tehachapi (−118.45,35.13). Other 14 retain the prior fixtures. Ridgecrest/Trona illustrate Mojave portfolio grouping; Lancaster/Tehachapi illustrate Western grouping. Site grouping is context, not another payout test.

Source: accepted superseding resolution in Choose the fictional treaty rules and recovery semantics; prototype `ac18828`, `prototypes/catlas-visual/portfolio-treaty.html`. Source-byte evidence archive is still subsequent build work.

### Comment 9c56d253-031a-47ba-a9de-b8c09ccb9a16 (2026-10-15T19:05:26.716Z)

## Resolution — agreed with Vineet, 15 October 2026

Both fixture-selection rounds accepted (“go with recommendations”). This specifies demonstration inputs and expected behaviour; it does not create an evidence archive or implement the application.

### Primary replay and evidence
Use the 2019 Ridgecrest earthquake, California, as the sole required historical replay. Source reference: USGS event `ci38457511` (alias `us70004bn0`); research-observed magnitude 7.1 `mw`, longitude −117.5993333, latitude 35.7695, occurrence 2019-07-06T03:19:53.040Z. Preserve precision; do not truncate the occurrence timestamp when packaging fixtures. [USGS event detail](https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=ci38457511&includesuperseded=true).

At fixture preparation, freeze the actual source response/evidence bytes and selected origin/magnitude identifiers, source/contributor, selection provenance, retrieval UTC timestamp and content digest, together with the contract/rule versions. Use the explicitly selected preferred event evidence in that captured response; do not select the newest timestamp indiscriminately across products. If required evidence is missing or incompatible with the agreed `mw` rule, surface it rather than silently changing the fixture. The research values above are a verified candidate reference, not a claim that an immutable bundle has already been created.

Present the replay as historical event evaluated from captured evidence, not a guaranteed reconstruction of what was known at the event time. South Napa may remain optional secondary context; it is not required for success or the primary walkthrough.

### Fictional contract fixtures
Coordinates below are latitude, longitude; data exchange must state its coordinate order explicitly.

| Treaty | Fixed reference | Limit | Coverage UTC |
| --- | --- | --- | --- |
| Pacific Quake A | 35.8, −117.4 | $10m USD | [2019-01-01T00:00:00Z, 2020-01-01T00:00:00Z) |
| Western Quake B | 35.4, −118.2 | $8m USD | Same interval |
| Regional Quake C | 38.1, −121.8 | $4m USD | Both dates deliberately missing |

Use the schedules and result precedence resolved in Choose the fictional treaty rules and recovery semantics. These are versioned fictional RAS-origin contract imports; no Catlas contract-authoring flow. Ridgecrest's unrounded great-circle distances are approximately 18.298 km / 68.107 km / 454.395 km respectively. Regional C illustrates that missing dates prevent a numeric assessment even when distance fails.

### Synthetic portfolio
Retain 18 global location markers, with California concentration, from the existing combined prototype. Required fields: stable synthetic ID, name, longitude, latitude; visibly identify the dataset as synthetic. Assign DEMO-LOC-01 through DEMO-LOC-18 in this order (coordinates longitude, latitude):

1. Los Angeles (−118.24, 34.05)
2. San Francisco (−122.42, 37.77)
3. San Diego (−117.16, 32.72)
4. Las Vegas (−115.14, 36.17)
5. Phoenix (−112.07, 33.45)
6. Fresno (−119.78, 36.74)
7. Sacramento (−121.49, 38.58)
8. Orange County (−117.9, 33.8)
9. Mexico City (−99.13, 19.43)
10. New York (−74, 40.7)
11. London (−0.13, 51.5)
12. Tokyo (139.69, 35.68)
13. Osaka (135.5, 34.7)
14. Sydney (151.2, −33.87)
15. Istanbul (28.98, 41.01)
16. Singapore (103.82, 1.35)
17. Vancouver (−123.12, 49.28)
18. Santiago (−70.67, −33.45)

No invented loss amounts or insured values. Location selection is contextual and must not alter a treaty reference point or generate an additional recovery.

### Five main walkthroughs
1. Historical Ridgecrest / Pacific A → 75% × $10m = $7.5m provisional recovery.
2. Separately labelled simulated M7.1 outer-band event at longitude −118.065, latitude 35.8, about 60 km from Pacific A → 37.5% × $10m = $3.75m. Use a synthetic ID and no historical occurrence date; provide an explicitly synthetic in-coverage timestamp for evaluation rather than borrowing a historical identity. The exact synthetic timestamp is fixture metadata, constrained to the agreed coverage interval.
3. Historical Ridgecrest / Western B → $0, Not triggered (M7.1 <7.5).
4. Historical Ridgecrest / Regional C → Needs review, no amount; coverage missing; exception download only, recovery submission blocked.
5. Labelled sensitivity/revision exercise at Ridgecrest's unchanged coordinates and in-coverage occurrence time: simulated M6.9 → reference M7.1 yields $5m → $7.5m for Pacific A. The S01 M6.9 is synthetic, not a retained historical USGS bulletin. The second observation uses the captured historical reference. Preserve evaluation versions; changed inputs invalidate review, require fresh review and retain earlier packets/delivery history.

### Secondary verification fixtures
Keep these separately labelled synthetic cases outside the main walkthrough: exact and adjacent magnitude boundaries 6.5/7.0/7.5; distance boundaries 25/100 km; coverage inception/expiry; beyond-100-km complete assessment; missing/unsupported required evidence; and known failed trigger plus missing coverage. Expected outcomes follow the resolved rules. Distinguish pure exact-distance rule cases from coordinate-derived cases subject to floating-point precision; never make a displayed rounded distance the input to the payout decision.

### Map layers and presentation
Earthquake epicentres, synthetic locations, fixed contractual bands and contractual reference/connector are distinct layers. World overview supports discovery and regional focus supports explanation. Satellite imagery is optional geographic context, not event evidence; preserve the offline analytical map path. No shaking or physical-loss layer is required, and distance rings must not imply either.

### Why this scenario
The same historical event exposes paid, zero and indeterminate outcomes across contracts. A separate synthetic event demonstrates distance-dependent payout; the labelled revision exercise demonstrates versioned explanation and renewed review without inventing historical evidence. The global location set exercises map exploration without affecting contractual recovery.

Discussion asset: `codex/catlas-visual-prototype`, commit `7b361c2`, `prototypes/catlas-visual/combined.html`; preceding POC `prototype/map-workbench`, commit `86a76e8`. Frozen source bytes and implementation fixtures remain build inputs to prepare, not artifacts created by this planning resolution. Final usability verdict remains in Test the workbench layout and explanation flow.

## CAT-6: Define the provisional recovery handoff to RAS

https://linear.app/vineetsarpal/issue/CAT-6/define-the-provisional-recovery-handoff-to-ras

### Comment 9dda1679-a1f3-4da0-b41e-44d442fa5e25 (2026-10-15T19:53:58.416Z)

## Packet amendment following accepted two-area treaty design

Keep one immutable reviewed packet per event × treaty × evaluation version and the existing download/delivery/revision rules. Add cedent identity, the two scheduled area references/allocations, two area assessment entries (distance, band, row/rate, contribution/status), and an aggregation section with uncapped sum, event cap and total recovery. The single-reference calculation fields are superseded by area assessments; do not send each area as a separate claim. The full revised amount remains the treaty total, not a delta or additive claim.

Revised example: main treaty Ridgecrest recovery is $6m ($4.5m Mojave + $1.5m Western). Sensitivity revision is $4m→$6m, with fresh review and a link to the earlier packet/receiving reference. Selecting an area for inspection is presentation-only and must not invalidate review or mutate the packet.

Source: user-accepted superseding treaty resolution; prototype `ac18828`, `prototypes/catlas-visual/portfolio-treaty.html`. Verified two-assessment JSON, aggregate sum, prior-delivery reconciliation, receiving-reference reuse, and unchanged reviewed packet after area selection. Existing receiver/archive limitations remain.

### Comment ccf8ca2d-4b37-456f-98d4-0c64001163cb (2026-10-15T19:13:20.901Z)

## Resolution — agreed with Vineet, 15 October 2026

Vineet accepted both live recommendation rounds. This defines the vendor-neutral demonstration handoff, not a production RAS API contract.

### Recipient, purpose and granularity
Recipient is downstream RAS/reinsurance operations. One packet represents one event × one treaty × one evaluation version. RAS authors and maintains contracts; Catlas imports them and prepares a reviewed provisional recovery assessment. Receipt is distinct from financial approval, an approved receivable or payment. Receiving terminology (claim/recovery/notice) is a later vendor mapping, not a reason to change this canonical assessment.

### Canonical packet content
- Identity: packet ID, schema version, evaluation ID/version, purpose, and previous packet/evaluation references for a revision.
- Contract: source RAS contract ID/version, coverage interval, limit and currency.
- Event/evidence: source event ID and aliases where present, occurrence time, raw magnitude/type, epicentre, historical/simulated labels, frozen evidence identities/references and capture provenance. A changing source URL alone is insufficient evidence identity.
- Calculation: rule ID/version, fixed reference coordinates, distance method/units/unrounded result, matched distance band and magnitude row, matrix rate, coverage assessment, evaluation status and provisional recovery amount/currency.
- Review: reviewer identity, review time, reviewed evaluation version, notes and exceptions. In the fictional demo, identify the reviewer as a demo persona rather than implying authenticated production approval.
- Declaration: provisional recovery handoff; explicit simulation/fictional-contract labels; no financial approval/payment implied.

Use explicit coordinate fields (latitude/longitude) or an explicitly declared array order. Preserve exact occurrence time and raw comparison inputs. Missing values are null/absent with reasons, never fabricated zeros. The reviewed packet is immutable; download and delivery use the same content. Record attempts, delivery status, receipt time and RAS reference separately alongside it.

### Eligibility and review
- Complete positive recovery: review required; enable JSON download and initial RAS delivery.
- Complete $0 assessment: reviewed JSON download only for the first demo; no initial recovery submission.
- Incomplete assessment: exception JSON download identifying missing/unsupported inputs, no asserted recovery amount; recovery submission blocked.
- Input changes require a new evaluation and fresh review, preserving prior packets and delivery history. No manual payout override.

The positive-amount restriction applies to initial submission. Do not apply it to a complete revision correcting a previously submitted recovery downward to zero; that is a linked correction to the existing assessment, not creation of a zero-value initial claim. Incomplete new evidence still blocks recovery revision and requires resolution of the exception.

### Delivery and identity
Provide analyst-initiated Send to RAS plus JSON download. Prefer outbound delivery; RAS collection remains a future transport alternative if a target requires it.

Distinct states: ready/reviewed, sending (or awaiting collection), received with reference, rejected with reason, and delivery unconfirmed. An elapsed timeout is not proof of rejection or receipt. After an ambiguous response, check status or retry with the same submission identity. The receiver deduplicates repeated attempts for that packet; retries must not create duplicate receiving records. A substantive payload change requires a new reviewed version and packet identity, not reuse of a prior identity with different content. Download alone never marks a packet received by RAS.

### Revisions
A freshly reviewed revision links to the earlier packet and, where known, the existing RAS reference. It conveys the full revised amount as a replacement assessment, not an additive claim. Example: initial full assessment $5m, revised full assessment $7.5m; the revised packet must not request an additional $7.5m. Retain both versions and acknowledgements; downstream RAS processing determines the accounting adjustment. If earlier delivery is unconfirmed, reconcile it using the original submission identity before claiming a receiving reference or silently opening a separate claim.

### Example handoff contract (illustrative readable values)
| Field | Initial reviewed packet | Revised reviewed packet |
| --- | --- | --- |
| Packet | DEMO-PKT-001 | DEMO-PKT-002 |
| Evaluation | DEMO-EVAL-A / v1 | DEMO-EVAL-A / v2 |
| Purpose | Initial assessment | Replacement assessment |
| Event | Ridgecrest reference; simulated M6.9 observation | Ridgecrest; captured reference M7.1 |
| Contract | DEMO-T01 / imported version 1 | Same contract/version |
| Distance / band | About 18.298 km / inner | Same |
| Rate / limit | 50% / USD 10m | 75% / USD 10m |
| Full provisional recovery | USD 5,000,000 | USD 7,500,000 |
| Previous packet | None | DEMO-PKT-001 |
| Receiving reference | Assigned on acknowledgement | Existing reference, e.g. MOCK-RAS-001 |
| Review | Demo analyst, v1, review timestamp | Demo analyst, v2, fresh review timestamp |

The first observation is explicitly simulated, not an asserted USGS historical bulletin. Actual evidence identities, raw distance and timestamps are populated from the frozen fixture bundle; example receiving IDs are mock values. Keep delivery acknowledgement outside the immutable submitted packet; a revision may reference a previously assigned receiving ID.

### Demonstration fidelity and acceptance
Real JSON download plus an explicitly simulated vendor-neutral RAS receiver; no production vendor selection, live writeback, notices to real counterparties, accounting postings or settlement/payment execution.

Show: reviewed packet contents; download/delivery content equivalence; successful receipt/reference; rejection/reason; ambiguous timeout/status check; retry deduplication; linked replacement assessment; review invalidation; zero-result download-only; incomplete exception export/submission block. Demonstrate synthetic contract import as the source boundary, not Catlas contract authoring.

The receiving mock validates the agreed packet contract and returns simulated outcomes. It establishes demo behaviour, not compatibility with any named RAS. Exact technical schema/connector implementation follows the specification and must not be presented as customer-tested.

### Sources and next decision
Existing combined prototype (`codex/catlas-visual-prototype`, commit `7b361c2`, `prototypes/catlas-visual/combined.html`) is a discussion source. Its current download/review behaviour may require updates to match this resolution. Next: Test the workbench layout and explanation flow validates these requirements with the actual interactive artifact; final customer-test criteria follow that validation.

## CAT-7: Test the workbench layout and explanation flow

https://linear.app/vineetsarpal/issue/CAT-7/test-the-workbench-layout-and-explanation-flow

### Comment b81c6a09-5ae4-4191-944b-81eb9a329b1d (2026-10-15T20:14:49.552Z)

## Internal UX direction resolution — 15 October 2026

Vineet reviewed the interactive workbench, identified unclear circles, requested a realistic cedent/treaty story, accepted the two-area adaptation (“lets do that”), and after the final trigger-zone explanation said “ok, let's go next”. Record this as acceptance to proceed with the current interaction direction, not an external customer usability or demand result.

Chosen structure: persistent map with event library/layers; progressive event selection; one cedent treaty total; two selectable scheduled-area contribution cards; selected-area circles, reference and payout matrix in the inspector; evidence/revision detail; reviewed aggregate packet and separate delivery/history views. Area selection changes presentation, not calculation or review. The insurer receives the treaty recovery; contextual property markers do not independently generate payouts.

Live feedback changes: strengthened/framed circle visibility; replaced arbitrary single-reference story with two named scheduled portfolio areas and explicit aggregation; labelled circles **Treaty trigger zones** and explained that they test epicentre position, not insured-property membership or damage extent. No epicentre-centred damage-radius circle. A future sourced ShakeMap layer remains optional, not required for this demonstration.

Primary source: branch `codex/catlas-visual-prototype`, model/UX commit `ac18828`; final terminology refinement in the immediately following commit. Current artifact `prototypes/catlas-visual/portfolio-treaty.html`, source additions `portfolio-flow.js`; standalone copy synced. Browser verification and remaining archive/satellite limitations are documented in prior comments and README.

Internal acceptance is bounded to advancing this specification with the chosen map/detail/aggregation flow. External analysts must still test whether they can explain recovery, distinguish circles from coverage/damage, handle revisions and judge the RAS handoff useful. That protocol and the build-readiness gate belong in Define the customer test and workbench specification exit criteria.

## CAT-8: Define the customer test and workbench specification exit criteria

https://linear.app/vineetsarpal/issue/CAT-8/define-the-customer-test-and-workbench-specification-exit-criteria

### Comment e6fa052f-4616-4338-ab9e-6e2113fdb863 (2026-10-15T20:23:46.512Z)

## Resolution — customer testing deferred, 15 October 2026

Vineet: “ok, we don't have any users right now but when we do we will look at this”. Proceed with specification and internal demonstration work; prospective-customer recruitment/testing is deferred until participants are available. Do not claim customer usability, demand, willingness to pay or production RAS compatibility from internal review or browser checks. No outreach or scheduling is authorized by this decision.

### Future protocol to retain and revisit
Starting participant target: three ceded reinsurance analysts plus one reinsurance operations/RAS user, preferably with parametric protection experience. Treat this as a future recruitment plan, not an available or committed participant list. Suggested 30-minute sessions begin without coaching or the guided tour, followed by comparison with the participant's current workflow.

Tasks: explain both scheduled-area contributions and the capped treaty total; distinguish trigger zones from property coverage/damage; revise evidence and recognise fresh-review requirements; handle missing coverage/exception export; download or deliver a packet and distinguish receipt, rejection and unconfirmed delivery from financial approval/payment.

Retain the proposed initial qualitative learning bar for later review: at least two of three analysts complete core tasks without coaching, with no unresolved critical payout/coverage/delivery misunderstanding; operations identifies a concrete packet use and missing fields. Small-sample task results are usability evidence, not statistical proof of demand. The user has deferred applying this test, so no pass/fail result exists.

Capture observed task completion/help needed, misunderstandings, missing evidence/packet fields, comparison with actual workflow and usefulness to the receiving team. Revisit the hypothesis if users lack the proposed parametric workflow, existing systems already satisfy the need, or the packet cannot support downstream work. Map styling praise alone is not a success signal.

### Specification exit criteria (distinct from market validation)
Ready for implementation planning when the decision map provides:
- A named analyst/cedent job and authority boundary.
- Explicit fictional contract, evidence, coverage, distance, aggregation and exception semantics.
- Reproducible fixture specifications with historical/simulation labels and a plan to package source evidence without inventing provenance.
- Accepted internal map/area/total/review/handoff interaction direction, with a preserved prototype source.
- Packet content and review, download, delivery, retry/revision behaviour.
- Bounded demonstration runtime, sharing/hosting, persistence, offline/network and evidence-packaging responsibilities proportionate to the demo.
- Future customer protocol and an explicit list of assumptions not externally validated.

The first five are indexed in the existing map; demonstration implementation boundaries remain a precise follow-on decision. Actual source archive, application implementation, deployment and live connector are not silently required deliverables of this planning ticket. The eventual spec/build handoff must label customer validation pending and identify the open proof points. Customer testing is not a prerequisite for completing this planning map.

Current discussion artifact: `codex/catlas-visual-prototype`, `prototypes/catlas-visual/portfolio-treaty.html`, model/flow `ac18828`, terminology `5f16013`. Internal review acceptance is recorded in Test the workbench layout and explanation flow.

## CAT-10: Set the demonstration implementation boundaries

https://linear.app/vineetsarpal/issue/CAT-10/set-the-demonstration-implementation-boundaries

### Comment be59e7cb-14ae-47d7-a9b2-e63451c79acb (2026-10-16T01:56:28.017Z)

## Resolution — confirmed with Vineet, 15 October 2026

Vineet accepted the sharing/history/identity recommendations and confirmed the final evidence/environment boundaries. Explicit additional gate: discuss and choose the technology stack before implementation.

### Demonstration scope
A shareable browser-based demonstration with an offline analytical presentation build. Optional satellite imagery may depend on internet; event investigation, area evaluation, review, JSON export and simulated RAS delivery must not depend on satellite services, live USGS or a live RAS. The offline build's run/open procedure will be chosen with the stack rather than assumed to require a particular framework or packaging format.

Use the resolved fictional cedent, one main treaty/two scheduled areas/18 contextual locations/five walkthroughs. High-threshold and incomplete-coverage contract variants remain explicitly fictional. Primary support is desktop in current Chrome/Edge, with usable responsive views down to 375px. Production portfolio scale, multi-peril/live monitoring and broader browser guarantees are not part of this demonstration specification.

### Persistence and identity
Retain evaluations, immutable reviewed packets and simulated delivery history locally in the browser across refresh. Explicit Reset demo data clears stored demonstration state; distinguish it from clearing current workspace selection. No shared database, cross-device history or multi-user collaboration in this scope. Include schema/version handling sufficient that a changed demo build does not silently reinterpret old evaluations as current rules.

Use a named demo analyst without sign-in; reviews and receiving acknowledgements are labelled simulated. Data is limited to public historical evidence and fictional contracts/portfolio; no real customer data/import credentials or production claims.

### Evidence and RAS boundary
Package versioned USGS evidence fixtures with actual source capture metadata and content digests, preserving raw values, event/source/observation identities and selection provenance. Freeze source responses/assets needed to reproduce the selected calculations; do not rely on a mutable URL alone or invent a capture timestamp/digest. Separate synthetic observations from historical evidence.

Package fictional RAS-origin contract JSON and a simulated receiver implementing the agreed packet, acknowledgement, rejection, uncertainty, deduplication and replacement-assessment behaviour. The offline receiver is a simulation, not proof of vendor API compatibility. No live writeback, financial approval, accounting postings or payment execution.

Actual evidence capture/package preparation is subsequent build work. Current throwaway prototype reference metadata is not itself that archive. A missing required fixture/provenance input must be visible during preparation rather than replaced with fabricated historical evidence.

### Build acceptance boundaries
- Main deterministic totals and exception/zero outcomes match resolved rules and fixtures; area selection is presentation-only.
- Evidence/contract changes create evaluation versions and require fresh review; prior packets/history survive refresh.
- The reviewed JSON carries both area assessments, uncapped sum, cap and treaty total; download and send use the same immutable content.
- Local mock receipt/rejection/unconfirmed/retry/revision behaviour matches the handoff decision without contacting real RAS.
- Core walkthrough works offline; unavailable optional imagery does not block it.
- Desktop and 375px flows remain operable; explicit reset returns to clean seeded demo state.
- Customer validation is labelled pending; internal browser checks are not presented as market demand or a real approval audit.

### Technology and implementation gate
This decision specifies behaviour/scope, not frontend framework, map engine, local storage technology, build tool or hosting provider. Choose the demonstration technology stack is the next required human decision. Do not begin the application build or provision/deploy services before that discussion and choice. Preserve throwaway prototypes as discussion sources; they do not dictate the production stack.

When the stack is chosen, hand off the decision index, current prototype (`prototypes/catlas-visual/portfolio-treaty.html`, `codex/catlas-visual-prototype`), versioned rules/fixtures, packet contract, acceptance checklist and explicitly deferred customer-testing assumptions to implementation planning. Application implementation and production deployment remain outside this wayfinding effort.

## CAT-11: Choose the demonstration technology stack

https://linear.app/vineetsarpal/issue/CAT-11/choose-the-demonstration-technology-stack

### Comment 25f4a48c-0cd0-45b1-9499-d2d2b3d4a547 (2026-10-16T02:19:38.180Z)

## Resolution — technology stack selected with Vineet, 15 October 2026

Vineet accepted React/TypeScript/Vite, then MapLibre and Dexie (“done”), then the calculation/testing and hosting/offline recommendations (“done”). This fulfils the explicit requirement to discuss and choose the stack before implementation. It does not provision services, deploy or begin the application build.

### Selected stack
| Concern | Choice |
| --- | --- |
| Frontend | React + TypeScript + Vite |
| Styling | Scoped CSS / CSS Modules |
| Map/globe | MapLibre GL JS |
| Geographic calculation | Pure TypeScript domain module using d3-geo spherical math/geometry |
| Local persistence | IndexedDB through local Dexie, with versioned schemas and explicit reset |
| Fixtures/packets | Versioned JSON, runtime validation and explicit historical/simulation provenance |
| Rule/persistence verification | Vitest |
| Browser acceptance | Playwright |
| Shareable hosting | Cloudflare Pages static deployment |
| Offline presentation | Downloadable build served by a documented local-server launcher |

Use compatible stable dependency versions pinned in the build lockfile at implementation time; no packages have been installed or versions silently selected in this planning session.

### Architecture boundaries
Keep event/contract input validation, coverage, magnitude, distance, band selection, area contribution, event cap and evaluation versioning independent of React, MapLibre and storage. The same evaluated result drives the UI explanation and immutable reviewed packet. Browser-local persistence stores evaluations, packets and separate delivery attempts/receipts; it is not a production financial record, multi-user audit or cloud sync service. Local Dexie is selected, not Dexie Cloud.

MapLibre renders geographic GeoJSON trigger polygons derived from the agreed spherical convention; screen-pixel circle layers, zoom or camera position do not decide coverage or payout. Use the explicit 6,371 km Earth radius for the selected rule. The renderer can use map/globe presentation without changing assessment inputs.

Static/browser execution is sufficient for this scope: packaged source/contract fixtures, local history and a simulated RAS adapter. No application backend, hosted database, sign-in or real RAS connector is selected for the demonstration. Separate replaceable input/output adapters preserve a future integration path without pretending the mock proves production compatibility.

### Why these choices / alternatives
React/Vite fits the agreed browser-only interactive workspace and static build; TypeScript can describe evaluation, packet and delivery states consistently. A full-stack framework is not needed by the current serverless demo scope, though it can be reconsidered if future server requirements emerge. No existing repository app stack dictated the selection.

MapLibre fits the analytical overlay/map/globe job. CesiumJS remains a future alternative if detailed terrain, buildings, altitude or other spatial 3D investigation becomes a defining task; it is not rejected on a false claim that MapLibre lacks globe/terrain. The God's Eye View inspiration is visual/workflow context, not an obligation to use its engine or copy source.

Dexie simplifies IndexedDB queries, transactions and schema migrations for structured local history compared with ad hoc storage code; hosted/shared persistence remains outside scope. Vitest covers deterministic boundary/exception/aggregation/persistence behaviour, while Playwright covers complete browser journeys, offline operation, refresh retention and reset.

### Hosting, offline assets and licensing
Deploy the static build to Cloudflare Pages during the later build/deployment phase. Also produce an offline bundle with a locally served analytical map, fixtures and all required scripts/styles/fonts/sprites. The launcher should use a documented stable local origin so refresh retention is predictable; hosted and offline origins have separate local browser data. Satellite imagery is optional and online, with its provider/access/attribution/cache rights checked before integration; no paid provider, imagery account or redistribution right is implied by selecting MapLibre.

MapLibre's BSD-3-Clause renderer license is distinct from basemap/imagery/font licenses. Preserve required credits and bundle only data/assets permitted for offline distribution. No satellite provider is necessary for core acceptance; any optional provider integration must not block offline walkthroughs. This is an implementation asset choice under those constraints, not an unresolved payout/product decision.

### Build handoff and current limits
Implement the chosen stack in a separate build session from the resolved decision index. Preserve the current throwaway prototype as a primary UX source; do not promote its imperative code or illustrative provenance into production without implementing the agreed model, validation and frozen evidence packaging.

Acceptance: resolved two-area treaty results and boundaries; full immutable aggregate packets; version/fresh-review semantics; exception/zero gates; mock receipt/rejection/unconfirmed/deduplicated retry/replacement handling; local retention across refresh and explicit reset; core offline operation; desktop Chrome/Edge plus responsive 375px views. Current prototype/browser checks are internal evidence only. Customer usability/demand remain unvalidated and testing is deferred until participants are available.

Primary docs and factual map comparison are linked in this ticket's earlier investigation comment. They support capabilities, not a guarantee of customer suitability. Stack choice is for the bounded demonstration, not an irrevocable production architecture.
