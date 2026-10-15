# Catlas visual prototype — throwaway

Question: how could God's Eye View's globe, layer controls and selected-object panels support Catlas's earthquake-to-recovery workflow?

Run from the repository root:

```sh
python3 -m http.server 8765 --directory prototypes/catlas-visual
```

Open http://localhost:8765/?variant=A. Use the bottom switcher or arrow keys:

- A: globe-led event workbench.
- B: portfolio-led workspace with a map and compact recovery summary.
- C: recovery review with a supporting map.

Select scenarios, move between initial/revised evidence, toggle map layers, switch 2D/3D, and preview/download the mock handoff packet. All event observations, contracts, calculations and exposures are illustrative. The 150 km circle is a contract boundary, not a shaking footprint. The illustrative 82 km distance is a fixture, not computed from display coordinates. Layer 02/03 in B are static comparison fixtures. No production implementation, real treaty evaluation or RAS connection exists.

Visual inspiration: https://github.com/bilawalsidhu/gods-eye-view. This prototype independently implements a dark spatial workspace; no upstream source or bundled assets were copied. Uses CesiumJS 1.124 via CDN, Esri World Imagery with on-map attribution, and Google Fonts. Internet is required for the map and fonts. Basemap imagery is not current event evidence. No data persistence.

No layout verdict has been reached; these variants are for user review. Branch: codex/catlas-visual-prototype. Relevant planning issue: CAT-7 (workbench layout and explanation flow).

## Combined prototype

Open `combined.html` directly, or visit http://localhost:8765/combined.html with the same server. This consolidated direction combines the earlier Catlas POC's progressive event → treaty → evidence → handoff journey with a dark spatial workbench and optional Cesium satellite globe.

- Five guided walkthroughs: inner band, outer band, unmet trigger, incomplete coverage and simulated evidence revision.
- Three selectable fictional treaties with simultaneous outcomes.
- Computed spherical great-circle distances (6,371 km radius), fixed 25/100 km treaty bands and a highlighted exclusive magnitude/distance matrix.
- Historical Ridgecrest/South Napa event reference metadata; fictional outer-band event. The S01 M6.9 observation is a labelled sensitivity simulation, not an archived USGS bulletin. No historical as-of evidence reconstruction is claimed.
- Evidence revision invalidates the local review; the JSON handoff carries the current evidence, rule, reference coordinates, distance, band, rate, amount and exceptions.
- Embedded D3 7.9.0, TopoJSON 3.1.0, world-atlas/us-atlas geometry from the previous prototype support an offline analytical map. Original library notices are preserved. Natural Earth data is public domain. Satellite rendering uses external CesiumJS 1.124 and Esri World Imagery, with visible provider credits. No upstream God's Eye View source or assets were copied.
- Source precursor: `/private/tmp/catlas-prototype-workbench/catlas-workbench-poc.html` and the artifact in the 2026-10-12 Catlas planning session. Earlier synthetic fixtures and matrix were retained.

Verified in Chromium: five outcomes ($7.5m / $3.75m / $0 / indeterminate / simulated initial $5m), revision to $7.5m, revision carried into packet, review invalidation, JSON download, map switching and analytical geometry. No production implementation or user validation verdict is implied. All prototype changes live on `codex/catlas-visual-prototype`; relates to CAT-7.

## Agreed-workflow review prototype

Open `workflow-review.html` directly, or visit http://localhost:8765/workflow-review.html using the same static server. This is the next discussion source for **Test the workbench layout and explanation flow**, following the resolved journey, treaty rules, replay fixtures and RAS handoff decisions. It is not a production implementation or customer-validation verdict.

Retains the combined map presentation and five walkthroughs. Adds explicit UTC coverage evaluation, raw `mw` validation, per-case evaluation versions, immutable reviewed packet downloads, exception export, initial-$0 submission blocking, a local simulated RAS receiver, acknowledgement/rejection/unconfirmed delivery, same-packet retries/status checks, linked replacement assessments and session history with preserved-packet download. Input changes require fresh review. Reset workspace clears selection; reloading clears all demo records. `review-flow.js` is embedded into the standalone file; it documents the interaction additions and pure assessment function.

The analytical map is the offline default; satellite imagery is opt-in. There are no network requests on load. Source reference metadata is embedded, with exact Ridgecrest occurrence milliseconds and clearly labelled simulated observations. **A frozen source-byte archive is not packaged in this UI study**: packet provenance marks capture time and digest as unavailable rather than inventing them. All receiving acknowledgements are mock responses, and the reviewer is a demo persona.

Browser verification exercised five guided outcomes ($7.5m, $3.75m, $0, Needs review, simulated $5m), JSON downloads, exception null amount, review gating, immutable download before/after delivery, rejection/retry, acknowledgement loss followed by deduplicated retry/status reconciliation, replacement links and preserved history. Spot checks covered inception/expiry, unsupported magnitude and failed trigger plus missing coverage. Desktop and 375px layouts inspected; mobile panels no longer overlap, and no horizontal overflow or runtime errors were observed. No external requests occurred during offline verification. Satellite imagery was not part of this pass.

User review remains pending: can the analyst explain the amount, distinguish evidence/version states and understand what was sent versus merely downloaded? The planning decision stays open until live feedback is recorded.

### Treaty-band visibility refinement

Following feedback that the bands were unclear, selecting a treaty now frames its fixed reference, 25/100 km zones and selected epicentre. Added stronger solid inner/dashed outer outlines, distinct mint/blue fills, direct radius labels and a fixed-centre label. The legend names each contractual band and explicitly distinguishes it from damage extent. The optional satellite view uses the same spherical ring geometry and treaty-focused framing; offline analytical desktop/mobile views were visually checked. The Pacific A outer circle is about 378px across at 1440px desktop width, with both labels visible; the recovery remains $7.5m.

No epicentre-centred damage circle was added. USGS ShakeMap guidance explains that shaking varies with rupture distance, site conditions and wave propagation, so a uniform distance circle is not a damage footprint. A possible later hazard overlay would need sourced/versioned ShakeMap data, a shaking-intensity legend and separation from contractual payout. Source: https://ghsc.code-pages.usgs.gov/esi/shakemap/docs2020/manual4_0/ug_background.html . This is a recommendation pending user feedback, not a new approved layer requirement.

## Portfolio parametric reinsurance demonstration

Open `portfolio-treaty.html` directly, or http://localhost:8765/portfolio-treaty.html. This supersedes the single-reference story for the current UX review; earlier files remain preserved discussion sources. `portfolio-flow.js` is embedded in the standalone file.

The fictional cedent Sierra Mutual buys one California Portfolio Earthquake Treaty, imported from simulated RAS as contract v2. Two scheduled portfolio areas have fixed references: Mojave (35.8, −117.4), $6m allocation; Western (35.4, −118.2), $4m allocation. The existing exclusive magnitude/distance matrix applies independently to each area. Add each contribution once, then cap at $10m per event. Overlapping circles may both trigger by this explicit fictional rule; nested bands inside an area are not added. The resulting recovery is for the cedent, not policyholder claim payments. Allocations are not insured values.

Ridgecrest M7.1 gives $4.5m + $1.5m = $6m. The simulated outer-band event gives $2.25m + $1.5m = $3.75m. Separate fictional contract variants illustrate zero below M7.5 and missing coverage. The simulated M6.9 → reference M7.1 exercise changes $3m + $1m = $4m to $6m and requires fresh review. Same evidence/source/archive limitations apply as in workflow-review.html.

The treaty-total inspector, two area cards and map distinguish area contributions from total recovery. Switching selected area is presentation-only and preserves evaluation/review. JSON carries cedent, both scheduled references/allocations, both assessments, uncapped sum, cap and total; one packet still represents event × treaty × evaluation version. Delivery/retry/reconciliation/history behaviour is retained.

Four contextual synthetic location fixtures were moved/relabelled to illustrate the two portfolio groups: DEMO-LOC-03 Lancaster (−118.14, 34.70), DEMO-LOC-06 Ridgecrest (−117.67, 35.62), DEMO-LOC-07 Trona (−117.37, 35.76), DEMO-LOC-08 Tehachapi (−118.45, 35.13). The other 14 remain unchanged. Ridgecrest/Trona are contextual Mojave group markers; Lancaster/Tehachapi are Western group markers. This grouping does not create additional payout conditions or claims.

Verified in Chrome: all five walkthroughs, two-assessment JSON, null exception amount, zero submission block, $4m → $6m revision with prior-delivery reconciliation and same receiving reference, retained history, area selection preserving the reviewed packet, and an artificial lower-cap check. Desktop and 375px layouts inspected; no runtime errors or horizontal overflow observed. Satellite multi-area geometry was updated but not verified online. All treaty allocations/aggregation are fictional terms inspired by documented parametric structures, not reproduced market wording or customer-validated contracts. Live UX verdict is pending.
