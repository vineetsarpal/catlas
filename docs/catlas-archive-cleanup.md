# Private archive cleanup

Vineet is the initial archive operator. Cleanup is an explicit private maintenance operation. It does not run from the browser, on a timer, during event discovery, or during backup rotation. This runbook describes the command and verification procedure; it does not authorize production cleanup or claim that hosted migration/deployment has occurred.

Apply the rerunnable archive schema and matching runtime together before using the command against a deployment. Set `ARCHIVE_BASE_URL` to that Worker's HTTPS `*.workers.dev` origin and supply its separate `ADMIN_TOKEN` through the private operator environment. The command does not read `PROOF_TOKEN`, accept credentials as command-line arguments, or load the browser/server bridge credential. All `/api/maintenance/*` operations require the administrative token. The frontend bridge refuses maintenance paths; administrative credentials must never become a `VITE_` setting, Pages/browser binding, committed file, screenshot or shared report.

Run from the repository root with Node 24+. Use a new local output path for each request; the command refuses to overwrite an existing file and creates its output with owner-only permissions.

```sh
node services/exposure-archive/scripts/cleanup.mjs preview --output /private/tmp/catlas-cleanup-plan.json
```

Preview saves a bounded plan and its expiry/confirmation value. Inspect that JSON before deleting anything. A plan contains at most 16 artifact objects and 16 routine logs. Eligibility uses captures strictly more than 90 days old and routine logs strictly more than 30 days old. Explicit retention overrides are excluded. An object shared with a recent or retained capture must remain protected; references include immutable capture history, not only the latest event pointer. Audit records are not routine logs.

Confirmation selects the saved plan, the same configured archive origin and a new receipt destination:

```sh
node services/exposure-archive/scripts/cleanup.mjs confirm --plan /private/tmp/catlas-cleanup-plan.json --output /private/tmp/catlas-cleanup-receipt.json
```

An interactive terminal asks for the exact plan confirmation value. In a noninteractive terminal, supply `--confirm` with that value copied from the reviewed plan. It is a plan-scoped confirmation value, not the administrative credential. Omitting or mistyping it sends no confirmation request. The saved plan is not an arbitrary deletion instruction: the server owns the candidate list and revalidates eligibility and retention state.

Unconfirmed plans expire after 15 minutes. Each confirmation request processes at most four artifact deletions, within the same reviewed plan. If items remain, the response stays confirmed rather than claiming completion. A started/confirmed plan can be explicitly resumed with the same plan and confirmation value after an interruption; use a new receipt output path each time. The command performs one bounded request and never retries automatically. If it times out or the response is lost, do not infer that deletion failed or reclaim bytes manually. Read status first:

```sh
node services/exposure-archive/scripts/cleanup.mjs status --plan /private/tmp/catlas-cleanup-plan.json --output /private/tmp/catlas-cleanup-status.json
```

Inspect the server's audit/status response and remaining/deleted/skipped items. An error receipt records only safe request status. A receipt still marked `request-started` means completion was not observed. Explicitly resume the same confirmed plan when appropriate; do not create an unrelated duplicate plan to hide unfinished work. The server records progress durably. Byte charges remain until deletion is confirmed absent, and interruption recovery must preserve that accounting. Expired capture writers and refetches must not restore uncharged objects.

Protect an artifact before it becomes a cleanup candidate:

```sh
node services/exposure-archive/scripts/cleanup.mjs retention --sha256 <artifact-sha256> --retain true --output /private/tmp/catlas-retention-receipt.json
```

Remove an override only deliberately:

```sh
node services/exposure-archive/scripts/cleanup.mjs retention --sha256 <artifact-sha256> --retain false --output /private/tmp/catlas-retention-release.json
```

Removing an override requires typing that exact artifact hash, or supplying `--confirm <artifact-sha256>` in noninteractive use. It does not delete the object. A subsequent separately previewed and confirmed plan decides whether it is eligible.

Event identities, aliases and product/capture manifests remain searchable after artifact cleanup. Deleted original bytes are reported as expired/unavailable, rather than exposed as a complete capture. An analyst can explicitly attempt normal bounded source acquisition; the provider may no longer serve that product. No fallback product or unaffected exposure result is fabricated. Complete browser-local saved investigations have their own originals and still reopen unchanged without the public archive. Browser case deletion remains a separate action.

Live cleanup does not rotate backups or reduce the declared backup allocation. Retained backup copies continue to count toward combined storage budgets. Audit records, immutable source metadata and retention decisions remain available for later backup/restore work. Do not reduce accounting merely because a delete was requested or a source object returned an error.

For disposable verification only, `--allow-local` permits an explicitly configured HTTP `127.0.0.1` or `localhost` origin. It does not permit remote HTTP or arbitrary HTTPS destinations. Use fixture credentials and isolated storage; never reuse the hosted administrative token in a local fixture. Local HTTP/PostgreSQL/object-store checks demonstrate application behavior, not provider billing, a hosted outage exercise or production deletion.

## Reproducing local verification

The archive HTTP suite uses only the fixed disposable PostgreSQL fixture described in the archive README:

```sh
CATLAS_POSTGRES_TEST=1 npm test --prefix services/exposure-archive
```

The integrated browser test uses a separate database on that same loopback cluster. Create `catlas_cat55_browser` with the fixture user `catlas_test` on port `55446`, then run:

```sh
CATLAS_CLEANUP_BROWSER=1 npm run test:e2e -- tests/e2e/archive-cleanup.spec.ts --workers=2
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if needed, as documented in the project README. The test creates separate desktop/mobile schemas inside this one disposable database and removes them after success. It runs the actual cleanup command through a local HTTP wrapper around the real archive handler, with real PostgreSQL and disposable in-memory object storage, then checks public expiry and exact browser-local saved-case reopen. It never reads `DATABASE_URL` or hosted credentials. These fixture-only checks do not delete from a real R2 bucket.
