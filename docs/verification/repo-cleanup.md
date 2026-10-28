# Repository cleanup verification

Local cleanup from baseline `97fd4aa`, October 28, 2026. Each activity is committed independently. No push or deployment is part of these checks.

## 1. Frontend unused code

Removed the unread discovery visibility state and writes, unused `Portfolio` import, and unused hazard-details time prop. `workspacePanel` remains the rendered panel state. Enabled `noUnusedLocals` and `noUnusedParameters` for the frontend only.

Before editing, the explicit unused-code compiler check reproduced exactly the report's three diagnostics. After editing, `npm run check` passes and `npm run test:frontend` reports 270 passed, one optional diagnostic skipped. Existing browser coverage is used because this activity removes unread code without changing behavior.

`npx playwright test tests/e2e/frozen-investigation.spec.ts tests/e2e/case-portability.spec.ts tests/e2e/shared-workspace.spec.ts --workers=2`: 42 passed across desktop and mobile. Covers event selection, saved-case reopening, portable imports, frozen inventory/evidence and mode coordination. Initial sandbox execution could not bind localhost (`EPERM`); rerunning with localhost access passed.
