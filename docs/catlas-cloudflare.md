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

Exposure uses a Pages Function at `functions/api/exposure/[[path]].ts`, using the narrow public-route handler in `functions/_archive.ts`. Production and preview have `ARCHIVE_API_ORIGIN=https://catlas-exposure-proof.vineetsarpal02.workers.dev` and an encrypted `ARCHIVE_PROOF_TOKEN` configured as of 2026-10-26. The token matches the existing archive Worker's `PROOF_TOKEN`. Redeploy Pages after changing bindings. Do not put the token in frontend `VITE_` configuration, source control or the offline ZIP. Maintenance routes are not proxied.

The offline ZIP remains static and excludes Functions and credentials. The Node/Fastify monitoring backend remains localhost-only; this archive deployment does not host `/api/monitor`.

## Archive Worker deployment

`.github/workflows/deploy-archive.yml` checks the archive package on pull requests and pushes affecting its directory or workflow. On `main`, successful checks deploy the existing `catlas-exposure-proof` Worker. Manual runs are also available on `main`. Checks install the pinned package dependencies, type-check, run fixture tests, and dry-run the Worker build on Node 24. Local PostgreSQL tests remain opt-in and are not claimed by this workflow. Deployments are serialized and use the committed resource bindings and storage limits. The workflow does not run database migrations, rotate runtime secrets, or acquire earthquake evidence.

One-time account-owner setup:

1. Create a dedicated Cloudflare API token for GitHub deployment, scoped to this Cloudflare account, with Workers Scripts edit, Account Settings read, and Workers R2 Storage read permissions. It does not need the archive's database URL or proof token.
2. In GitHub **vineetsarpal/catlas → Settings → Secrets and variables → Actions**, add the token as the repository secret **CLOUDFLARE_API_TOKEN**. Never paste its value into chat or a tracked file. The account ID is already configured in the workflow.
3. Open **Actions → Check and deploy earthquake archive → Run workflow**, select `main`, and verify both jobs pass. Until that secret is supplied, checks can pass but deployment fails with an explicit setup message.

Runtime `DATABASE_URL` and `PROOF_TOKEN` stay in Cloudflare. Schema changes require a separately reviewed migration before deploying dependent code. Pages continues to use native Git integration independently of this workflow.
