# Catlas

A browser-only earthquake workbench demonstrating provisional contractual recovery for fictional cedent Sierra Mutual. Captured Ridgecrest evidence produces Mojave $4.5m + Western $1.5m = $6m. Imported RAS terms, immutable reviewed packets, retained local history and simulated delivery/replacement workflows are implemented.

The broader event-and-exposure workbench is available at `/exposure.html`: frozen and live USGS shaking evidence, consolidated portfolio CSV import (up to 1,000 locations), MMI screening, local version history, CSV/print summaries and self-contained offline case bundles. See [exposure workflow and data boundaries](docs/catlas-exposure.md). Open the [live exposure workbench](https://catlas-workbench.pages.dev/exposure.html) to try portfolio investigation, linked regional filters and offline country/state map context.

[Open the live demonstration](https://catlas-workbench.pages.dev/) · [Download the verified offline bundle](https://catlas-workbench.pages.dev/catlas-offline.zip)

## Run and verify

Use Node 22.22 or a compatible newer version, Python 3.9+, and an installed Playwright Chromium or Chrome browser:

```sh
npm ci
npm run dev
npm test
npm run test:e2e
npm run package:offline
npm run test:offline
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an installed browser binary. `npm run release` runs unit checks, builds/packages the release, and verifies the extracted offline zip. The dev browser suite uses port 4173; extracted production acceptance uses port 4178. A package-cache-only developer install can use `npm ci --offline` when dependencies are cached.

The downloadable artifact is `release/catlas-offline.zip` with a SHA-256 sidecar. Extract it and run `python3 serve.py`, then open **http://127.0.0.1:4178/**. Recipients need no Node/npm/internet. Always use the same origin to retain browser-local history. Hosted and offline origins retain separate records.

Read [presenter walkthrough](docs/catlas-presenter.md), [offline instructions](docs/catlas-offline.md), [implementation architecture](docs/catlas-implementation.md), [Cloudflare publication procedure](docs/catlas-cloudflare.md), and [verification report](docs/catlas-verification.md).

`release/pages/` is the static Cloudflare Pages upload directory after packaging, including the downloadable `/catlas-offline.zip`. No backend, sign-in, paid imagery, satellite service or live USGS/RAS dependency is required. Treaty rings are fixed-reference trigger zones, not damage radii or property coverage. Historical evidence capture is distinct from actual event time and from simulated sensitivity observations. Receipt confirms simulated delivery only; no financial approval/payment, vendor compatibility or customer validation is claimed.
