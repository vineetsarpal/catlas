# Catlas

A browser-only earthquake workbench demonstrating provisional contractual recovery for fictional cedent Sierra Mutual. Captured Ridgecrest evidence produces Mojave $4.5m + Western $1.5m = $6m. Imported RAS terms, immutable reviewed packets, retained local history and simulated delivery/replacement workflows are implemented.

The broader event-and-exposure workbench is available at `/exposure.html`: frozen and live USGS shaking evidence, consolidated portfolio CSV import (up to 1,000 locations), MMI screening, local version history, CSV/print summaries and self-contained offline case bundles. See [exposure workflow and data boundaries](docs/catlas-exposure.md). Open the [live exposure workbench](https://catlas-workbench.pages.dev/exposure.html) to try portfolio investigation, linked regional filters and offline country/state map context.

[Open the live demonstration](https://catlas-workbench.pages.dev/) · [Download the verified offline bundle](https://catlas-workbench.pages.dev/catlas-offline.zip)

## Run and verify

Use Node 24+, Python 3.9+, and an installed Playwright Chromium or Chrome browser:

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

Monitor is available at `/?mode=monitor` and through the shared mode switch: live USGS earthquakes, NOAA NHC/CPHC cyclone context, optional animated NOAA GFS wind forecasts, location overlays and browser-local watchlists. See [Monitor workflow and source boundaries](docs/catlas-monitor.md). Wind forecasts and local vessel monitoring require the optional backend (CAT-35). Standalone builds show wind as unavailable; no browser decoder is shipped.

## Local monitoring backend

See [backend setup and limits](docs/catlas-backend.md) for localhost wind decoding and AIS vessel monitoring. The default frontend remains browser-only.

## npm workspaces

- `frontend/` — React/Vite application, browser unit tests, static assets and frontend build output (`frontend/dist/`).
- `backend/` — localhost Fastify service, ecCodes decoder worker and backend tests.
- `shared/` — `@catlas/shared` API schemas, wind types, NOAA acquisition and bounded response readers; neither application imports the other.
- `tests/` — browser integration/offline tests. Release tooling and deployment documents stay at the repository root.

Run `npm ci` once from the repository root. One root lockfile covers all three private packages. Root commands delegate to npm workspaces:

```sh
npm run dev              # frontend
npm run backend          # separate terminal; localhost API
npm run check            # all packages plus browser test types
npm test                 # shared, frontend and backend tests
npm run build            # shared/backend type checks and frontend bundle
npm run test:frontend -- src/monitor/wind.test.ts
npm run test:backend
```

Package-specific commands also work, e.g. `npm run build --workspace=@catlas/frontend` and `npm run check --workspace=@catlas/backend`. The backend and shared packages execute TypeScript through Node/tsx and Vite respectively; their build tasks type-check source rather than emit a standalone distribution. The frontend consumes shared source through declared package exports. Deploying the backend requires the root lockfile, backend and shared workspaces; it is not a standalone copy of `backend/`.

`npm run package:offline` still writes `release/pages/` and `release/catlas-offline.zip` at the root. For an independent browser-test port, use `CATLAS_E2E_PORT=4180 npm run test:e2e`.

Each application uses its own ignored environment file: `frontend/.env` and `backend/.env`. Copy the corresponding `.env.example` to get started. Frontend variables prefixed `VITE_` are public browser configuration; provider secrets belong only in `backend/.env`. Restart the relevant service after editing its environment.

Offline packaging explicitly disables the backend integration, regardless of local frontend `.env` settings.

## Portfolio workspace

The main URL opens **Portfolios** (`/?mode=portfolios`). Use the shared map-first workspace to manage multiple named insured-location portfolios. Search a place/address, review and adjust an unsaved pin, then add its insurance details and save. You can also drop a pin, enter coordinates manually, edit/delete existing locations, or import CSV with an acknowledged add/update-by-ID or replace-all preview. The active portfolio selector is shared across workspaces. Portfolios and the active selection persist in this browser's IndexedDB; there is no shared team storage. Export portfolio CSV to back up current locations. Use the labeled demo portfolio to explore without supplying data.

Monitor uses the active inventory. Exposure retains the portfolio snapshot used for its current investigation: editing, switching or deleting a working portfolio never rewrites that snapshot. Choose **Investigate latest portfolio** explicitly to create a new version from active holdings. Opening saved history or a portable case does not change the active inventory. Threshold and source-evidence revisions continue to use the investigation's frozen portfolio until the analyst explicitly investigates the latest one. Empty portfolios can be maintained but cannot be assessed; the supported limit remains 1,000 locations per portfolio and 2 MB per imported CSV. The vessel watch portfolio and imported reinsurance terms remain separate.

Place/address search uses the public Photon/OpenStreetMap geocoder with suggestions after a short typing pause (or immediate submission) and requires connectivity. Set the public `VITE_CATLAS_GEOCODER_URL` frontend variable to use another HTTPS Photon-compatible endpoint. The map shows packaged geographic context; street imagery is not added. Pin placement, manual entries and CSV work without geocoding or connectivity. See [portfolio search behavior and source limits](docs/catlas-exposure.md#map-first-portfolio-workspace).
