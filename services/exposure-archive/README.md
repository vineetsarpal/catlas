# Exposure capture/retrieval proof (CAT-45)

A thin, request-driven Worker serves a minimal browser inspector and forwards API requests to a SQLite-backed Durable Object. The Durable Object performs on-demand capture/retrieval; Neon stores public capture metadata and a private R2 bucket stores exact original USGS detail/grid bytes. This proof does not change the existing Pages deployment, assessment flow, monitoring backend or browser-local cases.

**Status:** deployed as the separate [capture proof](https://catlas-exposure-proof.vineetsarpal02.workers.dev/). The 2026-10-25 Durable Object experiment passed hosted capture, original-byte retrieval, cache reuse, and desktop/narrow browser verification. Front-door CPU stayed below 1.3 ms; three fresh captures used 16.662–22.972 ms CPU in the Durable Object, whose documented default CPU allowance is 30 seconds. Vineet approved CAT-45 on 2026-10-25; the proof gate is complete and CAT-46 can proceed. Neon accumulated account usage counters remain unverified, as disclosed during acceptance. This sample establishes feasibility, not sustained production capacity or a guaranteed zero bill.

Verification: 22 HTTP behavior checks, TypeScript checks, Worker build, hosted browser verification at two widths, and real Neon/R2 round trips. Nine immutable public captures and 18 original artifacts total 176,668,587 bytes. Grids with a source hash/length stream directly to checksum-verified R2. Original artifacts remain uncompressed; the grid hard limit is 32 MiB. The unknown-hash fallback has not been exercised in a live cloud run. Private evidence: `docs.local/research/2026-10-25-cat45-durable-object-proof.md`; the earlier stateless CPU findings remain in `docs.local/research/2026-10-24-cat45-hosted-proof.md`.

## Local checks

Node 24+ is required. The service has its own pinned dependencies and lockfile; it is deliberately outside the existing npm workspaces.

```sh
npm ci --prefix services/exposure-archive
npm run check --prefix services/exposure-archive
npm test --prefix services/exposure-archive
WRANGLER_LOG_PATH=/private/tmp/catlas-proof-wrangler.log WRANGLER_SEND_METRICS=false npm run build --prefix services/exposure-archive
npx playwright test --config tests/archive-proof.config.ts
```

HTTP tests substitute external storage/provider boundaries. Browser tests use intercepted fixture responses at desktop and narrow widths and check original-byte integrity, cache retrieval and explicit retry. Neither substitutes for the actual cloud proof below.

## Human setup and disposable cloud run

The named disposable proof resources are deployed under the approved experiment. This setup guide does not authorize a production deployment or billing change. The approved operating choice targets free allowances; R2 allowances are not a provider-enforced zero-charge cap. Request Vineet's approval for the named disposable resources before creating/deploying them. Keep resource names, chosen plans and approved configuration in the private measurement report.

1. **Cloudflare sign-in:** from this directory, run `npx wrangler login`. This requires the account owner in the browser. Check the selected account and Free Workers plan; leave the existing Pages project unchanged.
2. **Neon Free project:** create a disposable project in the [Neon console](https://console.neon.tech/), select Free, and obtain its PostgreSQL connection string using Connect/connection details. Keep scale-to-zero enabled. Never paste the connection string in chat, source files, shell arguments, measurement reports or browser inputs.
3. **Private R2 Standard bucket:** in the [Cloudflare dashboard](https://dash.cloudflare.com/), use a new empty dedicated bucket for this proof. Keep public access disabled. If enabling R2 requests billing/subscription confirmation, Vineet must review and complete that account step. No paid compute/upgrade is authorized. Replace the placeholder bucket name in `wrangler.jsonc` with this approved bucket. Do not reuse a bucket containing unrelated or backup objects: the proof's conservative accounting assumes dedicated storage.
4. **Secrets and schema:** create a local ignored `.dev.vars` in this directory containing `DATABASE_URL` and a newly generated random `PROOF_TOKEN` (at least 32 random bytes). Set file permissions to owner-only. Use the migration command below to initialize the disposable database. Install the same secrets on the approved Worker through interactive prompts: `npx wrangler secret put DATABASE_URL` and `npx wrangler secret put PROOF_TOKEN`. Do not include values in command arguments. The proof token is a temporary access gate, not application user authentication.
5. **Review and deploy:** inspect the resource bindings and conservative budget vars, run the local checks, then deploy only the approved disposable Worker with `npx wrangler deploy`. The config binds `CAPTURE_COORDINATOR` to `CaptureCoordinator` and creates its SQLite-backed class through migration `cat45-capture-coordinator-v1`. It uses the default Durable Object CPU allowance. No alarm, Cron, collection queue or heartbeat is configured; SQLite holds no archive application tables. Open its HTTPS URL, enter the proof token locally in the password field, and select a public event ID.

The database migration is an explicit operator action. From this directory, after securely setting the local env file:

```sh
node --env-file=.dev.vars scripts/migrate.mjs
```

For local Worker development, `npm run dev` reads `.dev.vars` and uses local R2. It still contacts the configured Neon database and USGS on explicit requests; use the disposable database. Local R2 results do not establish hosted durability.

## API and privacy boundary

All `/api/` requests require `Authorization: Bearer PROOF_TOKEN`. The same-origin inspector keeps the token in page memory only. It does not persist it, put it in URLs or send it to USGS. No CORS or insured-data interface is provided.

- `POST /api/captures` accepts exactly `{ "eventId": "ci38457511" }`. It returns existing immutable evidence or captures supported available source bytes. Extra fields are rejected.
- `GET /api/captures/:eventId` reads a saved capture only; it does not fetch provider evidence.
- `GET /api/artifacts/:sha256` retrieves original bytes using a verified stored reference.

Capture manifests identify the event, source/product, occurrence/update/capture times and both artifact hashes, lengths, source URLs and retrieval paths. The browser independently verifies SHA-256 and byte length before enabling each download. Explicit retry repeats the selected action. There is no automatic refresh, update check or retry loop.

Upstream requests are fixed to USGS event lookup plus supported HTTPS USGS grid paths, reject redirects and have size/time bounds. Only public event IDs are accepted. Insured locations, values, settings, assessments and case bundles stay outside this service. Product support and source availability must be checked; a found event is not a promise of usable evidence or an as-known-at-occurrence reconstruction.

## Hosted measurement procedure

Use a fresh disposable archive for an initial miss. Two candidate products were checked on 2026-10-24: Ridgecrest `ci38457511` (retrospective Atlas grid, about 16.6 MB original XML) and Türkiye `us6000jllz` (about 28.4 MB original XML). Product sizes/versions may change; recheck source metadata during execution. These are representative inputs, not a workload average or coverage promise.

Create a private ignored `.proof.env` with `ARCHIVE_BASE_URL=https://<approved-worker>.workers.dev` and `PROOF_TOKEN`. The runner reads secrets from environment variables, sends only public event IDs, runs at most three supplied events sequentially and performs no background work. From this directory:

```sh
EXPECTED_EXECUTOR=durable-object node --env-file=.proof.env scripts/measure.mjs nc216859 us2000ar20 --output ../../docs.local/research/cat45-hosted-requests.json
```

Each event does one capture, verifies both original artifacts, repeats capture to establish a hit and performs cached-only retrieval. A preexisting first hit is labelled as such; it does not count as a miss measurement. Failures are recorded, stop that event's path, and require an explicit rerun. The report omits tokens, connection strings and error bodies. Treat it as private operational data.

Before/after each run, retain the following alongside the report:

| Evidence | How to interpret it |
| --- | --- |
| Exact Worker config, code revision, dependency lockfile, resource plans/bindings and selected product manifests | Establish which runtime and evidence were actually tested; include effective bounds and backup reserve. |
| Worker invocation logs/metrics correlated with report request IDs | Record actual CPU time, wall time, failures, request/subrequest usage and large-payload behavior. HTTP elapsed and Server-Timing values are wall observations, not CPU measurements. Sanitize raw log exports before retention; never retain authorization headers. |
| Worker memory profile and runtime outcomes | Record how memory was measured and whether limits were hit. If only local profiling is available, label it local; do not invent a hosted peak-memory number. |
| Neon compute, database bytes and public network deltas | Measure warm calls and a cold request after natural idle suspension. Do not introduce a keepalive or recurring query to observe idleness. |
| R2 object-byte inventory and class A/B operation deltas | Compare miss/hit behavior, unchanged artifact identities and duplicate avoidance. Include reserved backup space and orphan accounting. |
| Browser walkthrough and downloads | Inspect provenance, verify both original-byte downloads, repeat retrieval and explicitly retry a failure. Confirm no insured-data requests in the network trace. |
| Idle interval | Close the proof, record the interval and inspect provider metrics afterward. No source discovery/capture or recurring Neon calls should occur while idle. |

Account for other activity and provider metric reporting delay when comparing usage. Record observations separately from estimates. Targeted budgets are at most 800 MB Neon / 8 GB combined R2; this proof deliberately uses tighter defaults. Read the actual vars before running. Basic lease/reservation limits are proof safeguards; broader interruption/concurrency hardening and production accounting belong to CAT-46/CAT-47.

## Fit decision and remaining release work

The ordinary Free Worker capture path exceeded its 10 ms CPU allowance in representative tests. The deployed topology keeps that Worker thin and executes capture in a SQLite-backed Durable Object. Cloudflare documents a default 30-second Durable Object CPU allowance and Free allowances of 100,000 requests/day and 13,000 GB-s/day; see [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Measured hosted captures now have CPU headroom. Request/duration allowances, payload limits and storage budgets still bound the pilot. The current proof R2 cap is 384,000,000 bytes, including a 128,000,000-byte backup reserve.

Neon Free lists 1 GB storage, 100 CU-hours/project, 5 GB public network transfer and five-minute idle suspension; see [Neon plans](https://neon.com/docs/introduction/plans). R2 Standard's monthly free allowances include 10 GB-month, 1 million class A and 10 million class B operations; see [R2 pricing](https://developers.cloudflare.com/r2/pricing/). Recheck actual account allowances before execution. Include backup space and operation headroom in estimates. These figures do not guarantee permanent free growth or a zero R2 bill.

Vineet reviews the hosted observations. If capture/retrieval fails free-tier constraints, retain the measurements and reopen the architecture choice before dependent work. Do not silently raise the compute plan, substitute providers, remove evidence or weaken reproducibility. Daily backup/restore, manual cleanup and full analyst journeys are later tickets; this proof does not declare those operational.

Source access: [USGS event API](https://earthquake.usgs.gov/fdsnws/event/1/). Credit U.S. Geological Survey; check contributed-product rights separately under [USGS use guidance](https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted). The public source response and grid must both survive original-byte/hash round trips.

## Concurrent and interrupted capture lifecycle (CAT-46)

The Durable Object admits one mutation at a time; cached GETs remain available. A three-minute Neon lease also fences reserve, alias association, publication and reconciliation across restarts or stale invocations. An expired owner cannot publish or release a newer owner's lease. Capture publication and source-ID association are atomic; discovering another source alias does not rewrite the original manifest.

A cached GET for an attempted but unfinished event returns `409 capture_pending` while its lease is live, or `409 capture_interrupted` after failure/expiry. An event with no attempt/capture remains `404 capture_not_found`. The inspector shows a fixed message and waits for explicit retry. No polling or automatic retry runs. A publication acknowledgement lost after commit is recovered by reading the retained capture; if it cannot be confirmed, the API reports `capture_uncertain` and requests explicit retrieval/retry. Cleanup failure cannot override a successful publication.

Each object-store operation has a 15-second caller deadline. Native R2 operations may still complete late; all reserved bytes therefore remain charged. Source acquisition and database operations retain their request deadlines. There are no recurring acquisition timers.

Private maintenance is `POST /api/maintenance/reconcile` with exactly `{}` and the same proof authentication. It uses the same mutation admission and lease, inspects at most sixteen unreferenced reservations, verifies available object length/checksum, and records `present`, `missing`, or `invalid`. Its response reports counts and `retainedBytes` for the inspected batch. It never publishes an orphan, deletes objects, or frees reservation charges. Candidates rotate by last reconciliation time. A later explicit capture retry may reuse verified bytes. Under slow services the lease may expire after partial classification; an explicit rerun continues safely. Physical cleanup/capacity reclamation requires a later separately verified procedure.

`schema.sql` is an additive rerunnable migration for the approved disposable archive. Existing manifests and original objects are retained. Deploy the schema before the updated Worker. The migration runner validates statement splitting before sending its transaction.

The default test command runs the HTTP fixture suite and skips PostgreSQL checks. To exercise the production SQL mapping through HTTP, initialize a disposable local PostgreSQL cluster (never the hosted database) with user `catlas_test`, database `postgres`, and local port `55446`, then run:

```sh
CATLAS_POSTGRES_TEST=1 npm test --prefix services/exposure-archive
```

The opt-in suite resets only that fixed local test database's proof tables. It never reads `DATABASE_URL`. Coverage includes simultaneous requests, interrupted writes, lease expiry, stale-owner cleanup, immutable alias reuse and shared-grid deduplication. Local PostgreSQL plus external storage adapters exercise SQL semantics; they do not simulate every hosted R2 failure. Browser checks exercise pending/interrupted messages and explicit-only recovery at desktop/narrow widths.

## Capacity, usage and provider refusals (CAT-47)

Application defaults and ceilings are 800,000,000 database bytes and 8,000,000,000 combined R2 bytes. The disposable hosted proof deliberately retains its tighter configured limits: 100,000,000 database bytes and 384,000,000 R2 bytes. Database admission reserves 2,000,000 bytes for bookkeeping/recovery. R2 accounting uses unique reserved original-artifact bytes plus the larger of the configured backup floor and the declared backup allocation. The proof backup floor remains 128,000,000 bytes.

`MAX_CAPTURE_ATTEMPTS_PER_DAY` defaults to100 (maximum1000). A persistent UTC-day counter charges each admitted acquisition before USGS access, including acquisitions that later fail. Saved-capture reuse bypasses this daily acquisition budget. Each attempt has at most two upstream requests, two object writes, and six object HEAD checks (including uncertain-publication readback); byte limits and request deadlines remain enforced. These are acquisition bounds, not total provider operation measurements.

`MAX_MAINTENANCE_REQUESTS_PER_DAY` defaults to20 (maximum100), separately limiting reconciliation and backup declarations. Each reconciliation inspects at most16 objects. Both counters occupy constant-size singleton rows and reset lazily on the first explicit request of a new UTC day. A busy or refused admission does not start source work. Read and mutation minute-rate keys are separate, so mutation traffic does not consume the read allowance. Provider services may still refuse reads themselves.

Private authenticated operator interfaces:

- `GET /api/maintenance/usage`: database size, reserved/referenced/abandoned artifact bytes, declared backup allocation, effective combined accounting/headroom, UTC-day capture/maintenance counts and configured limits. Reserved/abandoned bytes include missing or late writes; this is conservative application accounting, not physical R2 inventory or a provider bill.
- `POST /api/maintenance/backup-usage` with exactly `{ "bytes": <nonnegative integer> }`: declare an absolute backup allocation before a future backup writer uploads bytes. The lease-fenced transaction refuses combined over-budget declarations and allocation decreases. It does not create a backup. Safe reclamation belongs to the cleanup/recovery work, not an arbitrary smaller number.
- `POST /api/maintenance/reconcile` with `{}`: bounded orphan classification/reuse bookkeeping, retaining all byte charges.

New capture refusal uses `507 capacity_exceeded`; daily application usage exhaustion uses `429 usage_limit`. Recognized USGS throttling, R2 throttling/entitlement, and Neon quota/disabled-endpoint signals use `provider_quota` or `provider_suspended`. Unknown errors, permission failures and ordinary idle/cold-start behavior are not guessed to be exhausted subscription quotas. Provider diagnostics are not copied into these errors. If publication acknowledgement is uncertain, a recognized provider refusal remains classified and the message advises explicit retrieval/retry. The browser shows fixed safe messages and still permits saved-capture retrieval.

Small disposable PostgreSQL limits exercise full-budget admission, exact-cap refusal, failed-attempt charges, maintenance limits, backup growth/decrease refusal, and retained reads. External provider adapters exercise quota/suspension faults without deliberately exhausting live account allowances. These guards do not impose a provider-enforced zero-dollar bill, trigger an upgrade, delete evidence, or prove Neon account compute/network totals.

## Recent catalog discovery (CAT-48)

Authenticated `GET /api/catalog` accepts only `significant=true|false` (defaulttrue), `offset=0..450` in steps of50, and optional `end=<server-issued UTC ISO timestamp>`. Each explicit request queries USGS once for the last90 days, newest first, with a51-record lookahead and50-record page. The removable Catlas significance filter is strictly >600. A continuation reuses the first response's `range.end`; the anchor expires after24 hours. The API reports `hasMore`, `complete` / `more-available` / `partial` coverage and omitted-record counts. A ten-page cap is disclosed as partial when more records exist.

Source-confirmed aliases merge catalog identities; name similarity does not. Discovery changes no capture/manifest/artifact records, introduces no recurring work, and uses the existing read request limit. Source responses are bounded to8MiB and20 seconds with redirects refused. The main frontend accesses this private Worker through the narrow same-origin server bridge described in `docs/catlas-exposure.md`. Existing proof-inspector and maintenance routes remain separate.

## Historical catalog discovery (CAT-49)

The same authenticated `GET /api/catalog` accepts `mode=historical` with required `start` and `end` UTC ISO timestamps. This mode defaults to no significance restriction and has no Catlas starting-year cutoff. Optional public fields are `minMagnitude`, `maxMagnitude`, and the complete bounding box `minLatitude`, `maxLatitude`, `minLongitude`, `maxLongitude`. Magnitudes are finite decimal values; latitude is within ±90°, longitude within ±360°, minima must be below maxima and longitude span cannot exceed 360°. Extended longitudes support date-line searches. Dates must be calendar-valid and ordered; recent continuation expiry does not apply to historical dates.

Alternatively, `mode=historical&eventId=<USGS-source-ID>` performs an exact identity lookup, including source aliases. Other filters are refused with `eventId`; offset must be absent or zero. A source Feature is normalized into the same catalog page contract. Missing IDs (source 204/404) return a successful empty page; provider failures remain failures. Source-ID lookup is independent of date/significance; the page's compatibility `range` field is not an ID search restriction.

Historical pages preserve the same source/response bounds, 50-record pages, ten-page ceiling, partial-coverage disclosure and fixed USGS origin. Only the submitted public search fields cross the same-origin bridge. Neither discovery mode stores portfolios, assesses exposure, captures evidence, changes acquisition budgets or introduces scheduled work. The existing capture/reuse path and its integrity/capacity safeguards remain unchanged. Provider reference: https://earthquake.usgs.gov/fdsnws/event/1/ .

## Availability and explicit recovery (CAT-50)

Capture responses distinguish `evidence_unavailable` (no supported active product), `grid_unavailable` (selected active product has no numeric grid or its grid returns 204/404), `unsupported_layout` and `unsupported_units`. These are unassessable states, not zero intensity. Existing `capture_pending`, interrupted and uncertain-publication states continue to refuse incomplete captures. Source connection/body interruptions return safe `source_unavailable` errors; database, object-store and API failures remain separate `database_unavailable`, `object_store_unavailable` and `service_unavailable` outcomes. The bridge preserves recognized codes while replacing provider diagnostics.

Recovery is an explicit subsequent request. A failed request cannot rewrite retained captures, lower resource guards, publish an incomplete artifact or add recurring work. HTTP fixture checks cover provider, real Neon adapter, R2 and API interruption/recovery through public capture/manifest/artifact routes. Browser integration runs the real bridge/handler over disposable adapter fixtures and verifies the corresponding visible retry flow and unchanged saved local investigation. These checks do not simulate provider billing or claim a newly deployed hosted service.
