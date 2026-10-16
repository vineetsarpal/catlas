# Catlas demonstration implementation

CAT-13 through CAT-22 are implemented, verified and published at https://catlas-demo.pages.dev/, with a downloadable offline bundle. CAT-1 is the unchanged completed planning map. Customer validation remains deferred.

## Runtime and development

React/TypeScript/Vite, MapLibre, pure TypeScript/d3-geo calculation, Dexie/IndexedDB, Vitest and Playwright. Compatible pinned dependencies are installed from package-lock.json. Node 22.22+ and Python 3.9+ build/package the demonstration; the extracted offline recipient only needs Python. There is no backend, sign-in or live RAS connection.

`npm run dev` serves development on loopback. `npm run build` type-checks and produces static assets. `npm run package:offline` builds, supplies third-party notices/presenter/evidence metadata, validates captured source digests and produces `release/catlas-offline.zip`. `npm run test:offline` extracts that exact zip, checks every release-manifest file digest, then runs production browser journeys against its Python launcher. `npm run release` performs unit checks, packaging and extracted-bundle acceptance. `npm run test:e2e` covers broader lifecycle and error cases against development.

## Boundaries

- `domain/types.ts` separates raw input snapshots from strictly validated evidence/terms. Missing and unsupported inputs remain inspectable rather than being silently repaired.
- `domain/assessment.ts` calculates raw magnitude/UTC coverage/spherical distance, exclusive bands, both contributions and cap independently of React, MapLibre, clock and storage.
- `domain/packets.ts` owns immutable evaluations, lineage versions, version-specific review and canonical JSON serialization. Every input replacement creates a new evaluation; presentation does not. Complete zero and positive packets require a named unauthenticated demo review; incomplete assessments export exceptions with null amount.
- `persistence/repository.ts` stores exact snapshots, packets and separate delivery/submission/receiver rows in versioned IndexedDB. Schema incompatibility preserves raw history and exposes export/reset. The lifecycle hook publishes state only after successful durable transactions; failures do not falsely claim retention. Reload opens world discovery; resume uses the stored inputs/results.
- `delivery/model.ts` implements receipt, rejection, unconfirmed delivery, stable submission identities, deduplication and full replacement. `delivery/service.ts` performs transactions against the local receiver. Downloaded and submitted JSON is identical. Replacement review links the prior packet/receiving reference and requires reconciliation first; complete corrections to zero are allowed, incomplete replacements blocked.
- `data/fixtures.ts`, `revisions.ts`, `scenarios.ts` and `outer-event.ts` contain captured evidence references and explicitly labelled fictional/synthetic inputs. A simulated M6.9 observation preserves earthquake lineage without claiming a historical bulletin. Same-ID fictional RAS terms v3 enable a complete downward-to-zero correction; v4 demonstrates missing coverage.
- Components render current frozen evaluations and keep map/evidence/review/revision/delivery concerns separate. WorkbenchMap renders local land, geodesic fixed-reference zones and connectors, distinct earthquake/contextual site markers, world/regional and map/globe controls. All 18 amended site fixtures are context only. Area/layer/camera selection preserves reviewed content.

## Evidence and licensing

Raw USGS responses, selected product/origin/magnitude identifiers, aliases and measured source digests remain unchanged. The capture manifest distinguishes per-file completion, manifest preparation, event occurrence and product times. Summary `mw` is used literally; preserved XML `Mw` and origin linkage are not normalized to determine eligibility. Replay is not an as-of-event reconstruction.

Packaging copies actual installed runtime dependency LICENSE/NOTICE texts, including transitive dependencies, to `THIRD_PARTY_NOTICES.md`; MurmurHash's full MIT text is retained from its README. Natural Earth land is public domain; source and USGS credits remain in CREDITS.txt. No external fonts, sprites, satellite assets or remote scripts are needed. ZIP entry timestamps are normalized container metadata; measured packaging time and file hashes are recorded separately in release-manifest.json.

## Distribution and verification

The loopback Python launcher serves `dist/` on stable http://127.0.0.1:4178. Changing hostname, port, browser/profile or switching to Cloudflare changes the local-history origin. Clear selection preserves history; explicit reset clears browser demo/receiver data and leaves packaged evidence untouched.

See the separate presenter, offline, Cloudflare and verification documents. Hosting uses the authorized Cloudflare Pages project `catlas-demo`; the exact verified artifact was published and tested over HTTPS. No hosting credentials are packaged. Browser checks establish internal consistency and operability, not external usefulness, vendor integration or authenticated financial approval.
