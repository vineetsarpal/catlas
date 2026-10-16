# Cloudflare Pages publication

The live demonstration is https://catlas-workbench.pages.dev/. Download the offline bundle at https://catlas-workbench.pages.dev/catlas-offline.zip and its current SHA-256 at https://catlas-workbench.pages.dev/catlas-offline.zip.sha256.

## Git-connected production

Cloudflare Pages project **catlas-workbench** connects to GitHub **vineetsarpal/catlas**, production branch **main**, through the existing authorized Cloudflare Pages GitHub installation. Pushing to main triggers a native Cloudflare build and deployment. The implementation is published on main and codex/catlas-implementation. No Cloudflare API token or GitHub Actions deployment secret is needed in the repository.

Build settings: React (Vite) preset; repository root; command **npm run package:offline**; output directory **release/pages**; environment variables **NODE_VERSION=22.22.3**, **PYTHON_VERSION=3.13.2**. The command type-checks/builds the static app, validates genuine source evidence hashes, collects dependency license texts and packages the offline download. Run the unit and browser checks before pushing application changes.

Each build records actual packaging time, source commit, observed Git dirty state and file digests in the offline release manifest. The ZIP digest changes when packaging observations change; compare each downloaded ZIP with its own SHA-256 sidecar, rather than a prior release hash. These observations are separate from unchanged historical evidence provenance. Cloudflare dependency setup may affect the observed Git dirty state, which is reported without normalization.

## Migration and local operation

The original catlas-demo Direct Upload deployment was verified before migration. Cloudflare does not support converting a Direct Upload project to native Git integration, so catlas-workbench was created as a Git-connected project. The old project is removed only after the new production deployment passes browser and bundle checks. The prior release remains locally retained for recovery.

The packaged application has no Functions, backend, bindings, authentication credentials or Cloudflare runtime SDK. Vite uses relative local assets. The offline ZIP extracts to catlas-offline; run **python3 serve.py** and open **http://127.0.0.1:4178/**. Hosted, old hosted and offline origins have separate browser histories; export any history needed before leaving an old origin. No browser history is migrated automatically.

Verify each release over HTTPS: world opening, Ridgecrest $6m and both geodesic areas, genuine evidence and notices, all five cases, reviewed download, unconfirmed reconciliation, full replacements and correction to zero, reload/reset, and 375px usability. Download and validate the offline ZIP against its sidecar and per-file release manifest. Preserve the lockfile and run the extracted release checks for changed runtime assets.

Official documentation: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Direct Upload limitation](https://developers.cloudflare.com/pages/get-started/direct-upload/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).
