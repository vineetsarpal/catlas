# Running the Catlas demonstration

Use Node 22.22 or compatible newer Node. `npm ci`, then `npm run dev`. `npm run build` creates a static `dist/`; `npm run preview` serves it locally. All core assets are local. Never open the bundle as file://; a stable local HTTP origin is required for later IndexedDB history.

`npm test` checks the independent domain boundary and captured evidence integrity. `npm run test:e2e` checks desktop and 375px browser explanations with external requests blocked. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to select an existing Chromium binary if the pinned Playwright browser is not installed.

The historical replay evaluates current captured source evidence, not a historical bulletin sequence. JSON summary has literal `mw`; retained XML has `Mw`. The selected magnitude's origin linkage is preserved verbatim and is distinct from the preferred hypocentre. Calculation uses the raw selected JSON summary and matching CI origin product. Evidence SHA-256 digests are measured from retained bytes. The manifest's capture timestamp records capture preparation, not event or publication time.

The contract is a fictional simulated RAS v2 import, not Catlas-authored real insurance protection. No customer validation or production RAS compatibility has been established.

## Module boundaries

- `src/domain/types.ts`: runtime validated versioned event/treaty shapes; assessment and evaluation types. Later lifecycle should preserve raw inputs for incomplete evaluations, rather than forcing parse success.
- `src/domain/assessment.ts`: pure assess, matrixCell, spherical distance and geodesic triggerPolygon. No map, React, persistence or clock dependencies.
- `src/data/fixtures.ts`: validated main contract and captured Ridgecrest inputs; source manifest.
- `src/components/WorkbenchMap.tsx`: geographic presentation, fixed references and epicentre. Does not calculate payout.
- `src/App.tsx`: current view composition. Area selection only changes presentation. Future scenario/lifecycle controls should change substantive snapshots through an explicit evaluation boundary.

## Evaluation and packet lifecycle (CAT-16)

`src/domain/packets.ts` is the in-memory service boundary for subsequent IndexedDB retention. `LifecycleState` contains frozen `EvaluationRecord[]`, frozen `RecoveryPacket[]` and `currentEvaluationId`; opening the world workspace creates none. `evaluate` snapshots raw `EventInput`/`ContractInput`, then calculates from that same snapshot. Supplied missing fields become null, including absent coverage dates. Event×treaty lineage versions increase on changed snapshots, with `previousEvaluationId` retained. Only the latest exact unchanged snapshot can resume; changing inputs away and back requires a fresh version.

`createPacket` reviews only the current evaluation and returns the already frozen packet if one exists. Complete zero and positive assessments require named unauthenticated demo review. Incomplete assessments yield an unreviewed exception packet with null recovery and explicit reasons. There is one packet per evaluation. Notes cannot subsequently rewrite it; past packets remain downloadable during the session. Browser refresh retention is the next slice.

`packetSchema` validates complete/exception gates, review identity/version, cedent and lineage consistency, canonical rule constants, aggregation, and recomputed assessment agreement with raw inputs. `serializePacket` defines the exact JSON bytes for download and the future simulated send adapter. Delivery state/attempts/receipts belong outside this immutable content. JSON includes raw evidence provenance and genuine capture metadata; it does not fabricate historical observation revisions.

The service accepts injected `Runtime.now` and `Runtime.id` for deterministic tests; the browser uses actual UTC time and random UUID identities. It has no storage, network, map or React dependency.

`src/hooks/useEvaluationLifecycle.ts` exposes stable `evaluateInputs(event, contract)`, `clearSelection()` and `reviewEvaluation(id, notes)` actions. Scenario discovery invokes the same raw-input evaluation action that later evidence/terms revision can invoke. The hook is the local persistence attachment point. Extracted `PacketReview`, `EventEvidencePanel` and `AreaExplanation` keep map/evidence/review composition separate.
