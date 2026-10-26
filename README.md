# Catlas

A map-first catastrophe workbench for managing insured locations, monitoring hazards, investigating earthquake exposure and reviewing provisional contractual recovery. The default application runs in the browser with local storage; an optional localhost backend supplies wind forecasts and AIS vessel monitoring.

The main URL opens **Portfolios**. The shared navigation connects **Portfolios → Monitor → Exposure → Recovery**:

1. **Portfolios** — create a named inventory, add insured locations through place search, map pins or manual coordinates, or preview and import a CSV. Select the active portfolio for investigation.
2. **Monitor** — view earthquakes, cyclone context and optional US/Canadian fire and weather attention alongside active insured locations, then capture an earthquake for investigation.
3. **Exposure** — compare a frozen portfolio snapshot with captured USGS shaking evidence, screen locations by MMI, inspect regional totals and export an impact summary or self-contained case bundle. Revisions create new investigation versions.
4. **Recovery** — evaluate the selected earthquake against imported reinsurance contract terms, review the explanation and prepare an immutable reviewed recovery packet. Delivery, acknowledgements and replacements are simulated.

All workspaces use the same map-first layout: a left tool rail opens workspace options, the map remains in the center, and selected location or item details appear on the right. Portfolios keeps search, imports and settings on the left; Monitor keeps attention, locations, watchlist, feeds and layers there; Recovery separates assessment/history options from the selected recovery explanation. **Layers** lives in the left sidebar in every workspace; Monitor’s **Filters** menu sits immediately before **Appearance** on the map; zoom and north controls use the shared top-right position. On mobile, options and details open one at a time.

Exposure screening identifies potentially affected insured value; contractual recovery uses the imported treaty terms. Insured value, physical loss and provisional recovery are distinct measures. The fictional Sierra Mutual Ridgecrest recovery demonstration produces Mojave $4.5m + Western $1.5m = $6m.

Open a workspace directly with `/?mode=portfolios`, `/?mode=monitor`, `/?mode=exposure` or `/?mode=recovery`. `/exposure.html` remains an Exposure entry point. See [exposure workflow and data boundaries](docs/catlas-exposure.md) and [Monitor workflow and source boundaries](docs/catlas-monitor.md).

[Open the live demonstration](https://catlas-workbench.pages.dev/) · [Download the verified offline bundle](https://catlas-workbench.pages.dev/catlas-offline.zip)

## Run and verify

Use Node 24+, Python 3.9+, and an installed Playwright Chromium or Chrome browser:

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Run verification commands in another terminal:

```sh
npm run check
npm test
npm run test:e2e
npm run package:offline
npm run test:offline
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an installed browser binary. `npm run release` runs unit checks, builds/packages the release, and verifies the extracted offline zip. The dev browser suite uses port 4173; extracted production acceptance uses port 4178. A package-cache-only developer install can use `npm ci --offline` when dependencies are cached.

The downloadable artifact is `release/catlas-offline.zip` with a SHA-256 sidecar. Extract it and run `python3 serve.py`, then open **http://127.0.0.1:4178/**. Recipients need no Node/npm/internet. Always use the same origin to retain browser-local history. Hosted and offline origins retain separate records.

Read [presenter walkthrough](docs/catlas-presenter.md), [offline instructions](docs/catlas-offline.md), [implementation architecture](docs/catlas-implementation.md), [Cloudflare publication procedure](docs/catlas-cloudflare.md), and [verification report](docs/catlas-verification.md).

`release/pages/` is the static Cloudflare Pages upload directory after packaging, including the downloadable `/catlas-offline.zip`. No backend, sign-in, paid imagery, satellite service or live USGS/RAS dependency is required. Treaty rings are fixed-reference trigger zones, not damage radii or property coverage. Historical evidence capture is distinct from actual event time and from simulated sensitivity observations. Receipt confirms simulated delivery only; no financial approval/payment, vendor compatibility or customer validation is claimed.

Monitor is available at `/?mode=monitor` and through the shared mode switch: live USGS earthquakes, NOAA NHC/CPHC cyclone context, optional animated NOAA GFS wind forecasts, location overlays and browser-local watchlists. See [Monitor workflow and source boundaries](docs/catlas-monitor.md). US NIFC fire perimeters, Canadian CWFIS incidents and estimated fire areas, FIRMS/CWFIS satellite detections and US NWS and Canadian ECCC weather alerts add portfolio attention flags with source evidence and browser-local watches. Each fire/weather toggle controls both monitoring and map display. Fire/weather feeds require the optional backend; FIRMS detections also require `FIRMS_MAP_KEY` in `backend/.env`. Wind forecasts and local vessel monitoring require the optional backend (CAT-35). Standalone builds show wind as unavailable; no browser decoder is shipped.

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
npm run dev:all          # frontend + localhost API; enables backend integration
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

Use **Portfolios** (`/?mode=portfolios`) to manage multiple named insured-location portfolios. The workspace has a portfolio list, central inventory map, location inspector and collapsible locations table.

- **Search a location:** type at least three characters and pause for suggestions, or submit immediately. Use arrow keys and Enter to choose a result; Escape dismisses suggestions. Review the unsaved pin, drag it to adjust the position, then add insurance details and save.
- **Drop a pin / Add location:** place a point on the map, choose **Use map center**, or enter coordinates manually. An unsaved preview does not add a location; saving the location form does.
- **Import CSV:** download the template, preview usable/excluded rows and choose add/update by location ID or replace all. Review and acknowledge the changes before applying them. Each location needs an ID, name, coordinates and currency; blank insured value means unknown.
- **Inspect and edit:** select a map dot or a location name in the table to open its details. The selected table row is highlighted. Selecting from the table plays one brief expanding pulse on the map; selecting a map dot does not pulse. Reduced-motion preferences suppress the animation. Edits require an explicit save.
- **Resize the table:** choose **Show locations**, then drag the divider between map and table. Arrow keys adjust the split, Home/End move to its limits and double-click resets it. Hiding and reopening the table retains the split while that portfolio workspace remains mounted.

New manual locations default to **USD**, and the synthetic demo inventory uses USD throughout. Imported amounts retain their supplied currencies; totals remain separate by currency, with no automatic exchange-rate conversion. Existing saved investigations retain their original values and currencies.

The active portfolio selector is shared across workspaces. Portfolios and the active selection persist in this browser's IndexedDB; there is no shared team storage. Export portfolio CSV to back up current locations. Use the labeled demo portfolio to explore without supplying data.

Monitor uses the active inventory. Exposure retains the portfolio snapshot used for its current investigation: editing, switching or deleting a working portfolio never rewrites that snapshot. Choose **Investigate latest portfolio** explicitly to create a new version from active holdings. Opening saved history or a portable case does not change the active inventory. Threshold and source-evidence revisions continue to use the investigation's frozen portfolio until the analyst explicitly investigates the latest one. Empty portfolios can be maintained but cannot be assessed; the supported limit remains 1,000 locations per portfolio and 2 MB per imported CSV. The vessel watch portfolio and imported reinsurance terms remain separate.

Place/address search uses the public Photon/OpenStreetMap geocoder and requires connectivity; no API key or local backend is needed for the default endpoint. Suggestions start after a 450 ms typing pause, with requests spaced by at least one second. Only the typed search text and fixed query options are sent to the geocoder. Set the public `VITE_CATLAS_GEOCODER_URL` frontend variable to use another HTTPS Photon-compatible endpoint. The map shows packaged geographic context; street imagery is not added. Pin placement, manual entries and CSV work without geocoding or connectivity. See [portfolio search behavior and source limits](docs/catlas-exposure.md#map-first-portfolio-workspace).
