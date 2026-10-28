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
