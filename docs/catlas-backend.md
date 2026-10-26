# Local monitoring backend

CAT-35 adds a Node.js 24+ / TypeScript / Fastify service. Local mode remains the default. An authenticated VPS mode and Pages bridge are available; follow [the manual VPS deployment guide](catlas-monitor-vps.md) to install and verify them. Deployment is not established merely by having a healthy tunnel. Wind acquisition, decoding, validation and caching run on the backend, while the browser receives and renders vector grids.

## Run

To start both servers with backend integration enabled, run `npm run dev:all` from the repository root. Open the URL printed by Vite; Ctrl+C stops both servers. Frontend options can be forwarded, for example `npm run dev:all -- --port 4174`. The backend loads `backend/.env` if present.

Install dependencies with `npm ci`. In one terminal:

```sh
cp backend/.env.example backend/.env
# Optionally edit backend/.env and set AISSTREAM_API_KEY.
npm run backend
```

In another terminal:

```sh
VITE_CATLAS_BACKEND=true npm run dev -- --port 4174
```

Open http://127.0.0.1:4174/?mode=monitor. Alternatively copy `frontend/.env.example` to `frontend/.env` and restart Vite. Credentials belong only in `backend/.env` (ignored by Git), never a `VITE_` variable. Without a key, wind works and the vessel feed explicitly reports unconfigured. No sample positions are presented as live observations.

The API binds to `127.0.0.1:3001`. Vite proxies `/api/monitor` to it. Without a server token, the backend rejects non-local Host and Origin headers. Hosted mode requires a 64-character lowercase hexadecimal `CATLAS_MONITOR_TOKEN`; every request, including health checks over loopback, must authenticate. `CATLAS_MONITOR_HOSTED=true` refuses startup if the token is absent. Browser Origin headers are refused in hosted mode; the Pages bridge strips browser headers and supplies the credential. Client addresses used for per-IP limits come from the bridge only after successful authentication. Existing Funnel routing is untouched. Hosted routing uses `functions/api/monitor/[[path]].ts`; Vite's development proxy is not bundled into static output.

## Behavior and limits

- **Wind:** `/api/monitor/wind` discovers a recent NOAA GFS run; `/api/monitor/wind/grid?runAt=...&validAt=...` returns a little-endian float32 U grid followed by V, with JSON `X-Wind-Metadata` including source URL, model run, forecast valid time and acquisition timestamp. Only fixed NOAA URLs and recent six-hour runs / three-hour forecast steps through 48 hours are accepted. Range reads, component geometry, units and forecast timestamps are validated. No arbitrary URL proxy exists.
- Discovery metadata lives 30 minutes. Four immutable run/time grids (~2.1 MB total vector payload) are cached in memory. Concurrent identical requests share work. At most four distinct jobs queue and one decoder runs at a time. A worker thread owns ecCodes WASM, with a 45-second decoding timeout; it is terminated on completion. A cache miss can be slower; the measured first request is not a guarantee. Failed requests do not cache an invented or mismatched grid. The browser reports unavailable and can retry; it does not silently substitute a different forecast time.
- **Vessels:** `/api/monitor/vessels?viewer=...&bbox=west,south,east,north` leases a viewer for 45 seconds. The UI polls every ten seconds while visible and online. One compressed upstream AISStream connection subscribes to the union of active viewport boxes, with at most one subscription update per 1.1 seconds. Maximum 20 viewers, 5,000 latest vessel records and 5,000 static identities, 30-minute retention, 32 trail points per vessel, maximum 1,000 returned rows. Date-line bounds and trail splits are supported.
- Upstream reconnects back off from five seconds to five minutes. Provider rejection waits five minutes. A quiet feed is reported stale after two minutes and recycled after ten minutes; sparse coverage may legitimately produce no traffic. Disabling vessels or leaving Monitor releases the viewer; a closed/hidden browser expires automatically. No collection occurs without active viewers after the grace period.
- Each accepted position retains provider report time and server receive time separately. Invalid coordinates, AIS unavailable speed/course sentinels, old/out-of-order positions and malformed frames are rejected or represented as unknown. A report older than five minutes is labelled stale in details. Silence or no match is not proof of no vessels.
- Portfolio membership is browser-local, distinct from insured coverage. CSV accepts `name,mmsi,imo` headers with at least one identity per row, at most 200 rows / 100 KB. IMO matches require a static identity observed from the provider. The fictional sample list demonstrates import and supplies no simulated positions. Portfolio filtering operates on reports received in the subscribed map area; global portfolio tracking and historical voyage lookup are not implemented. No portfolio file is sent to AISStream.
- Trails and caches reset on restart. No database or durable observation archive is used. Memory includes the WASM decoder, Node runtime and vessel objects, beyond the small vector-grid payload. Application request logging is disabled; credentials/provider frames are not returned in errors.

## Verify

```sh
npm run check:backend
npm run test:backend
npm test
npm run build
```

Backend tests open only a local AIS stand-in and inject HTTP requests; they do not require credentials. The live NOAA smoke check exercises the real ecCodes decoder. Live AIS acceptance still requires your own provider key and cannot be inferred from stand-in tests.

Design references: God's Eye View checkout `e8b3a10a07f3f7b31feb0ecea146a01c6fa2e36b` (provider acquisition / polling / bounded-cache patterns), NOAA GFS and AISStream. This backend implementation does not copy the upstream application or renderer. Existing wind-rendering attribution remains in `frontend/public/monitor-sources.md`.

## Workspace ownership

Run the commands above from the repository root. `npm run backend` delegates to `@catlas/backend`, so its environment file is resolved within `backend/`. Source and tests are in `backend/src/` and `backend/tests/`. The backend imports only `@catlas/shared` for shared contracts/acquisition, never frontend modules. Root `npm test` runs all workspace tests; `npm run test:backend` selects just backend tests.

## Fire and weather warning feeds

Set `FIRMS_MAP_KEY` in `backend/.env` for NASA FIRMS detections. Obtain a free key from [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/map_key/); restart the backend after changing environment settings. The key is never sent to the browser. Missing credentials leave CWFIS detections, incidents/estimated areas, NIFC perimeters and warnings usable, and show FIRMS as unavailable.

The frontend uses `GET /api/monitor/fires`, `/api/monitor/perimeters`, and `/api/monitor/alerts`. Each returns a validated snapshot with acquisition time, source rows, stale/partial warning and rejected-record count. No portfolio coordinates or values are sent to upstream providers. The fixed regional FIRMS request, nationwide WFIGS request, fixed national/regional CWFIS WFS queries and US NWS alerts/official zones plus the national Canadian ECCC alert collection are independent of the portfolio. Cached evidence is bounded and memory-only; restart loses it. Requests are on demand. No background notifications, persistent event archive or new Exposure/Recovery assessment is provided.

`/api/monitor/alerts` combines NWS and ECCC with independent one-minute caches. Its optional `sources` array identifies each provider's acquisition time, evidence availability, stale/partial state and rejected records. One source can remain usable while the other is unavailable. ECCC uses the public GeoMet OGC API Features collection, with bounded pagination, fixed-origin next links and a shared response-byte budget. No ECCC credential is required. There is no polling worker on the server; the enabled visible browser requests refreshes. Expiry is reapplied when retained data is returned.

`/api/monitor/fires` combines FIRMS and CWFIS hotspots. `/api/monitor/perimeters` combines NIFC boundaries, CWFIS reported incident points and CWFIS estimated burned-area polygons. Each has a `sources` array with independent provider acquisition/availability, rejected counts and stale/partial state. CWFIS requires no key. Fire provider acquisition passes have a shared twenty-second request deadline per dataset, below the browser polling timeout. Three fixed WFS layers use GeoJSON in longitude/latitude (`CRS:84`), explicit record/observation time filters, stable attribute sorting and bounded offset pagination (20 pages of 1,000 records, 64 MiB acquisition budget per layer). Missing/inconsistent totals, repeated records and truncated pages fail the dataset refresh and retain its prior evidence; individual invalid records are omitted with a partial-coverage warning. No provider-supplied pagination URL is followed.

CWFIS incident records use ten-minute caching; hotspots and estimated areas use thirty minutes. The seven-day estimate window is an explicit Catlas activity filter, not an agency declaration that a fire remains active. Satellite observation time is kept separate from unknown polygon publication time. Reported point locations are not converted to polygons; negative containment sentinels are unknown, and provider status codes are not converted into percentages. Independent cache failure and rolling evidence expiry apply while serving retained data. CWFIS remains available when FIRMS is unconfigured.
