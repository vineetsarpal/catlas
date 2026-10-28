# Public archive recovery operations

CAT-56 adds private recovery points for the public archive's metadata and referenced source bytes. Insured schedules, locations and browser cases remain browser local; export their portable case bundles separately. A recovery point does not contain browser data, credentials, or infrastructure configuration.

## Before enabling daily maintenance

The checked-in Worker cron is `0 6 * * *` (06:00 UTC daily). The daily schedule and a distinct private administrative credential were deployed during the separately authorized CAT-57 hosted verification. See the current [hosted report](../docs.local/research/2026-10-28-cat57-hosted-implementation.md) for runtime identities, the first-run failure, correction and verification outcome. On a new target, configure a separate private `ADMIN_TOKEN`, distinct from `PROOF_TOKEN`, using the operator secret workflow. Never place it in Pages, browser storage, command arguments, screenshots or receipts. Preserve the SQL schema and runtime revision alongside recovery inventories.

The scheduled handler sends authenticated private backup start/advance/rotation requests through the archive coordinator. It performs no event discovery, source capture, public-provider request or heartbeat. Start resumes an existing building point. Each advance copies at most four referenced artifacts; the runner allows at most 16 advances, 60 seconds per complete HTTP request including its response body, and 240 seconds overall. Rotation runs only after completion. At most 18 maintenance requests are consumed, within the configured 20/day cap; other maintenance can exhaust the remaining allowance. An incomplete or failed point rejects the scheduled invocation and is never advertised as complete. A larger point may require explicit operator advances; the core's 256-reference upper bound is larger than one daily runner's 64-reference capacity.

Observe scheduled invocation failures through the deployed Worker's existing logs/alerting, and inspect the private inventory after failures. Alert when no complete point exists, the latest attempt failed, a building point has stalled beyond the run deadline, or the latest complete snapshot is older than 24 hours. Preserve earlier failed-point records as audit evidence; a historical failure followed by a newer verified complete point is distinct from an unresolved latest failure. Completion time alone is insufficient: inspect its snapshot creation time. This implementation exposes the evidence; hosted cron reliability, alert delivery, CPU allowance and the recovery objectives still require a hosted drill. Cloudflare documents a [15-minute scheduled wall limit](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) and plan-specific [CPU limits](https://developers.cloudflare.com/workers/platform/limits/); the application intentionally uses a shorter bound. Do not infer a free-plan production guarantee from local checks.

## Private operator commands

Use Node 24+. Securely populate `ARCHIVE_BASE_URL` with the intended HTTPS `*.workers.dev` origin and `ADMIN_TOKEN` in the shell environment. Do not put their values in shell command history. All examples run from the repository root. Every output filename must be new; the CLI creates it exclusively with mode `0600`, rejects existing files and symlinks, and never retries automatically. Each invocation makes one bounded request. A failed or interrupted receipt may show `request-started`; inspect inventory before repeating a mutation.

```sh
npm --prefix services/exposure-archive run backup -- inventory --output /private/tmp/archive-inventory-001.json
npm --prefix services/exposure-archive run backup -- start --output /private/tmp/archive-start-001.json
npm --prefix services/exposure-archive run backup -- status --id POINT_UUID --output /private/tmp/archive-status-001.json
npm --prefix services/exposure-archive run backup -- advance --id POINT_UUID --output /private/tmp/archive-advance-001.json
```

Replace `POINT_UUID` with the exact returned UUID. Inspect each receipt before another advance; stop on complete or failed. A failed point requires investigation of its reported error and stored bytes, not a claim of recoverability. Preserve the last complete point while diagnosing failed copies, checksums, quota refusal or missing bytes. Do not increase limits or remove charged storage to make a job appear successful.

Receipts record target origin, observation/finish time, measured elapsed milliseconds and the response's snapshot/point timestamps. They contain private public-archive metadata, so retain them in protected operator storage. The inventory is especially important: retain its complete point IDs, durable manifest keys and checksums **outside Neon**. A clean database cannot rediscover source database inventory after loss.

## Thirty-day retention and capacity

Completed points retain a consistent metadata snapshot and checksum-verified copies of every referenced original byte. Durable manifests live under `backups/points/<point-id>.json`; generation-pinned content lives under `backups/content/<sha256>/<generation-id>`. Use the exact physical key recorded in the manifest. Hash identity alone does not identify a physical generation. Shared content avoids thirty copies of unchanged bytes. Reuse checks the immutable generation’s R2-reported SHA-256 and byte length; if the server checksum is unavailable, it verifies the full bytes instead. A mismatch refuses completion. New copies and restored live originals still receive full-byte verification. Partial writes and uncertain writes consume capacity and do not make a point complete. Rotation removes only eligible old recovery history and unreferenced backup content; live archive cleanup is separate.

```sh
npm --prefix services/exposure-archive run backup -- rotate --confirm ROTATE_RECOVERY_HISTORY --output /private/tmp/archive-rotation-001.json
```

Rotation preserves the thirty-day window and shared references; it is also subject to bounded work and the maintenance allowance. Inspect its result before another invocation. Do not manually delete backup objects or reuse the reserved allocation for capture. The approved candidate configuration is 768,000,000 combined R2 bytes, including a 256,000,000-byte backup reserve, and a 100,000,000-byte database cap. These are source settings; the last hosted observation used the previous 384,000,000 / 128,000,000-byte limits. Retained older metadata and source histories can dominate usage even after a live view changes. Capture, cleanup and rotation must preserve pinned generations and in-progress reservations. If source bytes disappeared before a verified backup exists, fail the point rather than synthesizing or reacquiring different bytes.

As checked on 2026-10-27, [R2 Standard pricing](https://developers.cloudflare.com/r2/pricing/) lists $0.015/GB-month storage, $4.50/million Class A operations and $0.36/million Class B operations, with billing-unit rounding and account-level free allowances. These are provider prices, not this application's hard byte caps. Estimate operations separately from invoices: an unchanged point still writes a manifest and metadata, checks referenced content and performs bounded progress requests; newly copied generations add source reads, backup writes and verification reads. Rotation adds listing/read/delete work. Measure actual objects/bytes and calls with representative retention runs before extrapolating a monthly bill. The local drill and capacity evidence are recorded in the CAT-56 implementation handoff; no hosted invoice or thirty-day production history is claimed.

## Local representative measurement (2026-10-27)

The disposable PostgreSQL/object-adapter drill used genuine Ridgecrest detail and grid originals totaling 16,721,243 bytes. It created 31 complete points, removed live originals through private cleanup, then expired one point by a simulated 31-day age. Thirty complete points retained two shared content objects and about 16,927,550 recovery bytes. The additional 30 points and rotation consumed 30 puts, 90 gets, one head and one delete. Age simulation tests eligibility; it is not thirty days of observed production scheduling.

The clean-target desktop/mobile drill verified exact source hashes and reproduced 11 locations meeting threshold, two unknown and USD 128,000,000 in a saved browser-local case. Final local application restoration took 449/448 ms; snapshot age at restore start was 503/504 ms. The full local fixture, browser and 31-point exercise took about 12.5 seconds. Resource provisioning, real R2 transfer and hosted limits are excluded. These measurements do not establish the 24-hour freshness or one-working-day hosted recovery objective.

Unchanged content fits the configured cap; thirty entirely new independent pairs of that size would require about 1.003 GB for live plus recovery original bytes before metadata, exceeding both the earlier 384 MB and approved 768 MB combined caps. Preserve refusal and expose the failed fit. At the cited raw rates, 16.93 MB storage corresponds to roughly $0.000254/month and the additional 30-point requests to roughly $0.000168 before free allowances and billing-unit rounding. These call counts and arithmetic equivalents are not provider invoices or a growth guarantee.

## Restore into a clean target

1. Select a **complete** point from the saved inventory outside Neon. Preserve its UUID, snapshot creation time, durable manifest key and manifest checksum. Building or failed points are not restore sources.
2. Prepare disposable clean target resources with matching SQL schema/runtime and a new private administrative credential. Do not connect them to production browser clients. Copy the selected durable point manifest and exactly its referenced content objects, preserving exact object keys and bytes, from the recovery store to the target R2 bucket using authorized provider tooling. Read its generation-specific content keys from the manifest; copying manifests or hash-named guesses alone is insufficient. Do not copy unrelated backup points or orphan content: target restore accounts for the selected manifest and its referenced bytes. Target R2 must contain no live archive artifacts, and target database must contain no archive data. The restore endpoint checks the clean target gate. The source database is not required.
3. Set `ARCHIVE_BASE_URL` and `ADMIN_TOKEN` to the **target**. Inspect the target origin and known point ID before confirming. The confirmation acknowledges this exact point and empty archive; it does not authorize overwriting an existing archive.

```sh
npm --prefix services/exposure-archive run backup -- restore-start --point POINT_UUID --confirm POINT_UUID --output /private/tmp/archive-restore-start-001.json
npm --prefix services/exposure-archive run backup -- restore-status --id RESTORE_UUID --output /private/tmp/archive-restore-status-001.json
npm --prefix services/exposure-archive run backup -- restore-advance --id RESTORE_UUID --output /private/tmp/archive-restore-advance-001.json
```

4. Inspect every receipt and explicitly advance the returned restore UUID with new filenames until complete. Each advance is bounded. Interrupted restores remain unpublished; checksum mismatch, missing backup content or target conflicts must stop publication. Diagnose the failure and retain evidence. Do not bypass the empty target guard or manually publish partial rows.
5. Through the target's normal HTTP/browser flows, verify archived event identities, source observations and histories, original artifact URLs/bytes and checksums, cohort/detail readback, and frozen-case provenance. Open a separately exported browser case bundle and verify offline evaluation without acquisition. No maintenance operation should create provider traffic. Record snapshot creation time, inventory completion time, restore start/finish, elapsed duration, byte counts and failures. Include preparation/transfer time when assessing recovery time; the CLI's per-request elapsed duration alone is not total recovery time.
6. Keep production unchanged during the drill. Any eventual cutover is a separate operational action. Retain the drill evidence and protected recovery inventory outside the disposable database.

The operational targets are at most 24 hours of data loss and restoration within one working day. Local HTTP/browser evidence demonstrates behavior, not a hosted SLA. A stalled daily job, quota exhaustion or missing alert can exceed the freshness target and must remain visible.

These backups share the archive's R2 bucket and account. They protect against database loss and live-artifact cleanup mistakes, but cannot independently recover from loss of the entire bucket/account. Retaining the inventory outside Neon is necessary but not sufficient for that failure: an independently retained copy of the complete backup namespace and deployment/schema material is also required. This ticket does not provision an offsite destination or claim independent disaster recovery.
