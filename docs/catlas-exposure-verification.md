# Exposure release verification

Verified 2026-10-17 America/Toronto (2026-10-18 UTC), macOS arm64, Node v24.10.0, installed Google Chrome via Playwright. This records technical acceptance, not customer validation.

## Results

| Check | Result |
| --- | --- |
| `npm test` | 108 passed; separate diagnostic skipped by default |
| `npm run test:e2e -- --workers=2` | 58 passed across desktop and 375px mobile, including existing recovery regressions |
| `npm run package:offline` | TypeScript and production build passed; archive prepared |
| `npm run test:offline -- --workers=2` | 8 passed against extracted archive with external requests blocked |
| `git diff --check` | Passed |

Browser runs used `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Acceptance covers invalid/partial imports and acknowledgement, duplicate IDs, missing values and intensity, currency separation, supported-size pagination, keyboard selection, long event labels, explicit source/threshold revisions, saved-history refresh, portable-case roundtrip in fresh history, altered-case rejection and offline operation. Render checks require loaded shaking and rendered land; settled map and mobile layout were visually inspected. Mobile document width remained 375px at a 375px viewport.

Replay result: 18 synthetic locations; 11 meet MMI≥4, five below, two unknown. Screened known value is USD116m and CAD12m separately; one screened location has unknown value. These are exposure-screening results, not damage or loss.

## Live source smoke

Direct Chrome-origin requests from the workbench fetched the real USGS all-day feed and current Ridgecrest event detail/numeric grid without a backend or API key. Recent event `us6000u32r` (M4.8, 31 km SE of Kainantu, Papua New Guinea; occurrence 2026-10-18T00:28:29.111Z) had no supported ShakeMap at capture: the UI retained all 18 locations as unknown and displayed undetermined screened totals. Live provider contents can change after this observation.

Deterministic browser fixtures separately verify explicit evidence-update application creates another version while the original saved result stays unchanged. Public acquisition uses event IDs and product URLs; insured-location data remains local.

## Capacity diagnostic

`CATLAS_EXPOSURE_DIAGNOSTIC=1 npm test -- src/exposure/diagnostic.test.ts` passed against the actual 581×474-node Ridgecrest grid. See [machine-readable observations](verification/exposure-diagnostic.json).

The supported 1,000-location baseline produced 590 screened, 300 below and 110 unknown locations. Local Node grid parsing took about 121ms and assessment about 1.02ms. A separate 10,000-location diagnostic took about 3.05ms for assessment. These are calculation timings only, not browser rendering, memory, concurrency or production SLA claims. Imports remain limited to 1,000 rows.

## Prepared artifacts

- Local entry: `http://127.0.0.1:4187/exposure.html`; deployed/offline entry: `exposure.html`.
- Archive: `release/catlas-offline.zip`, 5,871,194 bytes.
- SHA-256: `9565894e5a07196f6e7a7247777ee5e78970d90d29f5447c9bbb830a176d9054`.
- Packaged at `2026-10-18T01:58:28.004981+00:00`.
- Local visual captures: `output/playwright/exposure-release-desktop.png`, `exposure-release-mobile.png`, `exposure-release-map.png`.
- [Analyst journey and operating limits](catlas-exposure.md).

The production bundle retains the existing MapLibre chunk-size warning (>500kB); no compilation errors occurred. No public deployment was performed. First release is earthquake-only; hurricane workflows and direct customer PAS/RAS connectors remain future work. Browser-local retention is specific to the URL origin; use portable cases to transfer snapshots. Near-real-time discovery is subject to provider publication and ShakeMap availability. Customer usefulness remains unvalidated.


## Updated interface and geographic-context release checks

The subsequent React interface update adds shared navigation, linked location/status/region/business-line filters, regional screened-exposure summaries, map appearance/layer controls, and native MapLibre country/state boundaries and place labels. Public-domain Natural Earth data and the OFL Noto Sans font are packaged locally.

Before production publication, the updated source passed 112 unit tests (one separate diagnostic skipped), 58 desktop/mobile browser checks, and all eight extracted offline acceptance checks. Offline exposure acceptance explicitly requires rendered boundary features and geographic labels while external requests are blocked. Manual browser checks also verified world country labels, regional place labels, geographic visibility toggles, unchanged exposure results and full CSV exports under view filters. The production build retains the existing bundle-size warning.
