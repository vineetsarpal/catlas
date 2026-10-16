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
