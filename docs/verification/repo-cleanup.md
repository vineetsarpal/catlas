# Repository cleanup verification

Local cleanup from baseline `97fd4aa`, October 28, 2026. Each activity is committed independently. No push or deployment is part of these checks.

## 1. Frontend unused code

Removed the unread discovery visibility state and writes, unused `Portfolio` import, and unused hazard-details time prop. `workspacePanel` remains the rendered panel state. Enabled `noUnusedLocals` and `noUnusedParameters` for the frontend only.

Before editing, the explicit unused-code compiler check reproduced exactly the report's three diagnostics. After editing, `npm run check` passes and `npm run test:frontend` reports 270 passed, one optional diagnostic skipped. Existing browser coverage is used because this activity removes unread code without changing behavior.

`npx playwright test tests/e2e/frozen-investigation.spec.ts tests/e2e/case-portability.spec.ts tests/e2e/shared-workspace.spec.ts --workers=2`: 42 passed across desktop and mobile. Covers event selection, saved-case reopening, portable imports, frozen inventory/evidence and mode coordination. Initial sandbox execution could not bind localhost (`EPERM`); rerunning with localhost access passed.

## 2. Orphan direct acquisition

A repository-wide symbol search confirmed `acquireEarthquake` had no application callers. Removed that function, its private product schema and obsolete acquisition assertions; retained the mixed test's discovery assertions and `LIVE_FEED` / `discoverEarthquakes`. Moved the shared result type to `exposure/capture.ts` as `EarthquakeCapture`. The archive capture/check implementation and all request payloads are unchanged.

- `npm run check`: passed.
- `npm run test:frontend`: 269 passed, one optional diagnostic skipped (one obsolete direct-acquisition test removed).
- Existing `archive-availability-flow` and `evidence-versioning` browser suites: 10 passed across desktop/mobile. The same invocation included `monitor-hazards`; 16 backend-only cases skipped in standalone configuration and are not claimed as coverage.
- Existing `past-events --grep 'Monitor opens'`: two passed across desktop/mobile, verifying Monitor discovery opens archive evidence without automatic assessment.
- Symbol search finds no remaining `acquireEarthquake` or `LiveCapture` in frontend source; `git diff --check` passed.

## 3. Complete local code verification entry point

Added `verify` → `check:all`, `test:all`, `build:all`, plus explicit archive-unit and deployment-tooling commands. The archive retains its independent install/lockfile. README documents both installs, localhost needs, local PostgreSQL opt-in checks, browser journeys and packaged offline acceptance. Archive unit verification explicitly excludes the two database suites even if an integration opt-in variable is inherited. No existing CI job or release command changed.

`npm run verify` passed with dependencies already installed in this checkout: shared 2, frontend 269 (one optional skip), backend 35, archive 90 and deployment tooling 7 tests passed; all type checks, frontend production build and archive Wrangler dry run passed. No fresh dependency installation or clean-checkout reproduction was performed. The first sandbox-only attempt failed on two backend localhost listeners; rerun with localhost access passed. Vite retains its existing large-chunk warning. Deployment fixture messages refer only to temporary local fake releases; Wrangler explicitly exited after `--dry-run`.

## 4. Neutral browser download utility

Moved `downloadFile(filename, blob)` unchanged to `frontend/src/browser/download.ts`. Exposure, portfolio CSV and simple Recovery exports import it there; packet and raw-history exports now reuse it. Serialization stays with each owning module. Source review confirms unchanged filenames, MIME types, raw-history trailing newline, compression and one-second object-URL revocation. A read-only subagent reviewed the complete baseline-to-cleanup diff and found no actionable regressions.

- `npm run check`: passed; frontend unit suite: 269 passed, one optional diagnostic skipped.
- Existing `packets`, `history`, `portfolios`, `exposure` and `cat15` browser suites: 37 passed; one mobile history case failed because the history panel was absent after reset (not during download). `npx playwright test tests/e2e/history.spec.ts --project=mobile --grep 'real IndexedDB' --workers=1 --repeat-each=3` then passed three consecutive isolated runs. No application or test changes were made in response; the original panel-visibility failure did not reproduce and its cause remains unconfirmed.
- `npm run package:offline && npm run test:offline -- --workers=2`: production build, ZIP digest verification and all 14 extracted offline desktop/mobile checks passed. Coverage includes reviewed packet downloads/delivery, portfolio persistence and transfer/reopen of revised cases with services unavailable.
- Local ZIP: 8,290,498 bytes, SHA-256 `c2f7a01d603c4a2d82bf0db390274a2b9c4d6265797265eedea8c10a11a51ea1`. Generated before this activity's commit; packaging metadata identifies a dirty source checkout. This is a local verification artifact, not a published release.

## Report review and remaining work

Review against `97fd4aa` confirmed all eight reported opportunities plus the wind reader issue remain applicable. A read-only subagent independently audited findings 2–8 and wind; supporting details are in the local untracked research note `docs.local/research/repo-cleanup-2026-10-28.md`.

The following are deferred from this low-risk batch:

- Catalog validation alignment: padded offsets and recent timestamp normalization differ. Keep validation at both HTTP trust boundaries and service-specific expiry checks; specify intended behavior before changing either.
- Table resizing: Exposure and Portfolios have different bounds, keyboard controls and pointer cleanup. Decide intended interactions before sharing code.
- Workbench lifecycle and provider extraction: preserve epoch/race guards, frozen portfolio/evidence, provider-independent cache/coalescing and stale policy through incremental changes.
- Wind reader lock release: observed lifecycle inconsistency, not a demonstrated leak. Any behavior correction needs a red/green regression at the approved acquisition HTTP seam.

These activities introduce no acquisition schedules, insured-data upload, archive maintenance changes, storage-cap changes or evidence recalculation. No behavior change requiring a new TDD cycle was included; existing HTTP/browser regressions verify the behavior-preserving cleanup.
