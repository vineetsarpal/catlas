# Cloudflare Pages publication

The live demonstration is https://catlas-workbench.pages.dev/. Download the offline bundle at https://catlas-workbench.pages.dev/catlas-offline.zip and its current SHA-256 at https://catlas-workbench.pages.dev/catlas-offline.zip.sha256.

## Git-connected production

Cloudflare Pages project **catlas-workbench** connects to GitHub **vineetsarpal/catlas**, production branch **main**, through the existing authorized Cloudflare Pages GitHub installation. Pushing to main triggers a native Cloudflare build and deployment. Pages does not need a GitHub Actions deployment secret; the separate archive Worker workflow below does.

Build settings: React (Vite) preset; repository root; command **npm run package:offline**; output directory **release/pages**; environment variables **NODE_VERSION=24**, **PYTHON_VERSION=3.13.2**. Node 24 is configured for production and preview as of 2026-10-26. The command type-checks/builds the static app, validates genuine source evidence hashes, collects dependency license texts and packages the offline download. Run the unit and browser checks before pushing application changes.

Each build records actual packaging time, source commit, observed Git dirty state and file digests in the offline release manifest. The ZIP digest changes when packaging observations change; compare each downloaded ZIP with its own SHA-256 sidecar, rather than a prior release hash. These observations are separate from unchanged historical evidence provenance. Cloudflare dependency setup may affect the observed Git dirty state, which is reported without normalization.

## Migration and local operation

The original catlas-demo Direct Upload deployment was verified before migration. Cloudflare does not support converting a Direct Upload project to native Git integration, so catlas-workbench was created as a Git-connected project. The old project is removed only after the new production deployment passes browser and bundle checks. The prior release remains locally retained for recovery.

The offline ZIP has no Functions, backend, bindings, authentication credentials or Cloudflare runtime SDK. The hosted Pages application additionally deploys the root `functions/` directory as its same-origin archive bridge. Vite uses relative local assets. The offline ZIP extracts to catlas-offline; run **python3 serve.py** and open **http://127.0.0.1:4178/**. Hosted, old hosted and offline origins have separate browser histories; export any history needed before leaving an old origin. No browser history is migrated automatically.

Verify each release over HTTPS: world opening, Ridgecrest $6m and both geodesic areas, genuine evidence and notices, all five cases, reviewed download, unconfirmed reconciliation, full replacements and correction to zero, reload/reset, and 375px usability. Download and validate the offline ZIP against its sidecar and per-file release manifest. Preserve the lockfile and run the extracted release checks for changed runtime assets.

Official documentation: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Direct Upload limitation](https://developers.cloudflare.com/pages/get-started/direct-upload/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## Workspace layout requirement

The npm workspace layout keeps the build root at the repository root, command `npm run package:offline`, and publication directory `release/pages`. Frontend build output is `frontend/dist`, which the packaging script reads. Keep Node 24+ to match package engines and ecCodes. The archive service remains outside the root npm workspaces and has its own lockfile.

## Hosted archive bridge

Exposure uses a Pages Function at `functions/api/exposure/[[path]].ts`, using the narrow public-route handler in `functions/_archive.ts`. Production and preview have `ARCHIVE_API_ORIGIN=https://catlas-exposure-proof.vineetsarpal02.workers.dev` and an encrypted `ARCHIVE_PROOF_TOKEN` configured as of 2026-10-26. The token matches the existing archive Worker's `PROOF_TOKEN`. Redeploy Pages after changing bindings. Do not put the token in frontend `VITE_` configuration, source control or the offline ZIP. Maintenance routes are not proxied. CAT-55 source changes require a distinct Worker-only `ADMIN_TOKEN` for every `/api/maintenance/*` route; it must not match `PROOF_TOKEN`. Never add this administrative credential to Pages bindings or frontend configuration. Its provisioning and the cleanup schema/runtime deployment are separate operator actions and are not claimed by the 2026-10-26 bridge configuration. See [the private cleanup runbook](catlas-archive-cleanup.md).

The offline ZIP remains static and excludes Functions and credentials. The Node/Fastify monitoring backend remains localhost-only; this archive deployment does not host `/api/monitor`.

The optional VPS Monitor deployment is documented in [the manual VPS guide](catlas-monitor-vps.md). Its Pages bridge uses separate `MONITOR_API_ORIGIN` and encrypted `MONITOR_API_TOKEN` bindings. Enable it only after the authenticated VPS health checks pass; change the Pages build command to `npm run package:pages` and set `VITE_CATLAS_BACKEND=true` for production. The separate hosted build preserves the backend-independent offline ZIP. Preparing these files does not establish that Monitor has been installed on the VPS.

## Archive Worker deployment

`.github/workflows/deploy-archive.yml` checks the archive package on pull requests and pushes affecting its directory or workflow. On `main`, successful checks deploy the existing `catlas-exposure-proof` Worker. Manual runs are also available on `main`. Checks install the pinned package dependencies, type-check, run fixture tests, and dry-run the Worker build on Node 24. Local PostgreSQL tests remain opt-in and are not claimed by this workflow. Deployments are serialized and use the committed resource bindings and storage limits. The workflow does not run database migrations, rotate runtime secrets, or acquire earthquake evidence.

One-time account-owner setup:

1. Create a dedicated Cloudflare API token for GitHub deployment, scoped to this Cloudflare account, with Workers Scripts edit, Account Settings read, and Workers R2 Storage read permissions. It does not need the archive's database URL or proof token.
2. In GitHub **vineetsarpal/catlas → Settings → Secrets and variables → Actions**, add the token as the repository secret **CLOUDFLARE_API_TOKEN**. Never paste its value into chat or a tracked file. The account ID is already configured in the workflow.
3. Open **Actions → Check and deploy earthquake archive → Run workflow**, select `main`, and verify both jobs pass. Until that secret is supplied, checks can pass but deployment fails with an explicit setup message.

Runtime `DATABASE_URL`, `PROOF_TOKEN` and the separately provisioned CAT-55 `ADMIN_TOKEN` stay in the archive Worker's Cloudflare secrets; only the public-event proof credential is shared with the server-side Pages bridge. The administrative token is never a deployment-workflow or Pages/browser credential. Schema changes require a separately reviewed migration before deploying dependent code. Pages continues to use native Git integration independently of this workflow.

CAT-56 adds the private [public archive recovery workflow](catlas-archive-backup.md) and a daily 06:00 UTC maintenance schedule in source configuration. The schedule calls only bounded recovery operations through the archive coordinator. Applying it requires the additive schema and distinct Worker-only administrative secret; neither deployment nor hosted scheduling is established by local verification. Recovery manifests and their exact referenced content must survive loss of the source database. Keep an operator inventory outside Neon and follow the runbook before selecting a clean restoration target.

## Exposure activation review (CAT-57)

The [acceptance evidence and release plan](catlas-exposure-acceptance.md) records the current source configuration, dated hosted versus local results, and required human decision. Fresh hosted usage showed that a complete first backup could not fit the earlier 384 MB combined pilot cap. Vineet has approved a 768 MB combined cap with a 256 MB backup reserve, now applied to source configuration. This resolves the capacity choice; matching deployment, daily scheduling and hosted recovery acceptance remain pending. Pushing main can deploy both Pages and the archive automatically; preparation and passing local tests do not authorize that push or replace schema ordering, hosted recovery evidence or Vineet’s activation decision.

CAT-57 hosted follow-up: Vineet authorized the coordinated release and disposable verification; schema/runtime and matching Pages build are now deployed. The approved768MB/256MB limits are effective. The [current hosted report](../docs.local/research/2026-10-28-cat57-hosted-implementation.md) records successful journeys, restore/cleanup/fault checks and the observed first daily backup failure, deployed checksum-preserving reuse fix, quota-limited rerun and pending activation decision. Earlier statements describing undeployed CAT-55/56 setup are dated preparation context.

Final CAT-57 verification completed2026-10-28: real scheduled resume/rotation passed, normal20/day maintenance limit and sole daily06:00UTC trigger restored and provider-confirmed. Final Worker version `f1c08fd1-3ae8-47ae-8ba2-b8548510de0f`; storage768MB/256MB remains. Activation still requires Vineet’s review of the evidence and disclosed limitations.
