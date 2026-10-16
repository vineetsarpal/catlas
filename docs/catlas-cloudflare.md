# Cloudflare Pages publication

The concrete upload is the static `release/pages/` directory produced by `npm run package:offline`. The application files are also inside the verified offline zip under `catlas-offline/dist`. The Pages payload adds `/catlas-offline.zip` and its SHA-256 sidecar alongside the app files, separately from the offline staging directory to prevent recursive archives on rebuilding. No Functions, backend, bindings, credentials or Cloudflare runtime SDK are required. Vite uses relative local asset paths.

Published 16 October 2026 after user authorization and OAuth consent to the selected Cloudflare account. Dedicated Direct Upload project **catlas-demo**, production branch **main**. Live URL: https://catlas-demo.pages.dev/; immutable deployment URL: https://f35b0f48.catlas-demo.pages.dev/. The already verified directory was uploaded without rebuilding. No credentials are embedded in the release.

The completed publication used:

```sh
wrangler login
wrangler pages project create catlas-demo --production-branch main
wrangler pages deploy release/pages --project-name catlas-demo --branch main
```

Future uploads can deploy to the existing project; do not recreate it. The local installed Wrangler 4.24.3 help confirms `pages deploy [directory]`, `--project-name` and `--branch`. Wrangler accepts the static folder rather than the offline launcher zip. Record the deployment's returned URL and validate the selected deployment over HTTPS before calling it published.

For Git-integrated builds, use repository root, build command **npm run package:offline**, output directory **release/pages**, Node **22.22.3** and Python **3.13.2** (or compatible versions). Python is only used to collect notices/package artifacts. Preserve the lockfile and run the extracted release checks before approving an equivalent rebuilt deployment. Direct Upload and Git integration have different project setup choices; the operator should choose deliberately for the intended project.

Post-publication checks: fresh world opening; Ridgecrest $6m and both geodesic areas; genuine evidence and notices accessible; all five walkthroughs; reviewed download; unconfirmed reconciliation; full replacement and correction to zero; reload/reset; 375px no horizontal overflow. Hosted and local URLs have separate browser histories. All six production acceptance journeys passed over the live HTTPS URL in installed Chrome, with desktop and 375px viewports. The downloaded `/catlas-offline.zip` matched SHA-256 `f7012cfe9a5d976c51f744c25ebae20e8b9f3d8a03845a8fe61adebb902384df`.

Official documentation checked 16 October 2026: [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [React/Vite guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/). Those sources document prebuilt uploads, build/output settings and Pages URLs. No new framework adapter is needed for this static application.
