# Catlas implementation architecture

Catlas is a feature-oriented modular application. Pure calculation modules sit beside stateful workflow modules and concrete storage, network and map adapters. The application shell composes those modules; features own their behavior and presentation. This structure improves locality without introducing a generic plugin framework or requiring complete feature isolation.

This guide describes the source tree. Local verification and source changes do not establish that a hosted deployment has been updated. Domain terms live in the root `CONTEXT.md` when present; dated acceptance records remain in `docs/verification/` and the workflow documents.

## Runtimes

| Runtime | Ownership | Storage and connectivity |
| --- | --- | --- |
| `frontend/` | React/TypeScript/Vite browser application with MapLibre | Dexie/IndexedDB stores portfolios, frozen investigations and recovery history. Packaged historical evidence works offline; discovery and geocoding need connectivity. |
| `backend/` | Optional Fastify monitoring backend | Wind decoding, vessel monitoring and fire/weather acquisition. Provider configuration stays on the server. |
| `functions/` | Cloudflare Pages request bridges | Narrow same-origin bridges to the configured monitoring backend and Exposure archive; server credentials stay outside browser assets. |
| `services/exposure-archive/` | Separately deployed Cloudflare Worker and capture coordinator | Neon stores public capture metadata; private R2 stores original evidence bytes and recovery copies. It has its own dependencies and lockfile. |
| `shared/` | Shared schemas, wind types, acquisition and bounded response readers | No application-internal imports. The frontend and backend consume declared package exports. |

The static offline package disables backend integration. It does not package the monitoring backend or the archive runtime. Hosted archive setup, operating constraints and recovery procedures are documented in the [archive README](../services/exposure-archive/README.md).

## Browser ownership

```text
frontend/src/
  app/          mount, navigation, Workbench, shared frame and shell styling
  events/       shared observation schemas, historical fixture and evidence manifest
  portfolios/   editable insured-location inventories, import and geocoding
  exposure/     frozen investigation lifecycle, evidence, screening and presentation
  monitor/      feed session, attention, watches, map rendering and presentation
  recovery/     recovery workflows, presentation, fixtures and styling
    parametric/ calculation, immutable packets and evaluation persistence/lifecycle
    delivery/   simulated receiver, acknowledgements and replacements
  maps/         shared MapLibre host, geography and camera behavior
  components/   shared presentation, dialogs and insured-location table controls
  browser/      shared browser helpers
```

`main.tsx` and `exposure/main.tsx` call `app/mount.tsx`, which owns the React root and QueryClient. Both URLs mount the same `app/Workbench.tsx`; their default workspace differs. `app/navigation.ts` interprets workspace URLs. There are no forwarding modules at the former file locations.

`Workbench` owns application composition and shared selection/navigation. `WorkbenchLayout` receives concrete presentation slots rather than feature-specific panel callbacks. `monitor/useMonitorWorkspace.tsx` and `recovery/useRecoveryWorkspace.tsx` own their panel state, focus/mobile/Escape behavior and rendered content. Their `WorkspacePresentation` interface names the frame locations: header actions, summary, rail, options and inspector. This seam gives the shell leverage without teaching it each feature's controls.

The presentation hooks remain mounted across mode changes. Recovery's workbench remains mounted while hidden, preserving its workflow state. Monitor's panel content follows the active mode. Portfolio has its own map instance; Monitor, Exposure and Recovery share a retained main map instance. A workspace switch does not recreate that main map.

## Workflow modules and adapters

**Portfolio and Exposure:** Portfolio owns the editable inventory. An investigation freezes the portfolio and captured source evidence used for assessment; changing or deleting an inventory does not rewrite a saved investigation. Explicit revisions create new versions. Exposure's lifecycle coordinates asynchronous reads, durable writes and visible state: stale reads cannot replace a newer selection, and writes already requested can finish without reopening an abandoned view. Reopening uses the saved version's exact inputs. Source-detail changes remain pending until explicitly applied. See [Exposure workflow](catlas-exposure.md).

**Monitor:** `monitor/session.ts` owns the six query observers, feed cadences, one set of online/offline/visibility listeners and the display clock. Its interface provides subscription/snapshots, connection cleanup, enabled-feed configuration and explicit refresh. Configuration differences restart only affected feeds. Concrete loaders cross the network seam; injected loaders let session tests exercise scheduling, cancellation and errors through the same interface. `useMonitor.ts` consumes the session and retains preferences, watches, selection, forecast/vessel handling and unavailable-backend presentation. There is no dynamic feed registry. See [Monitor workflow](catlas-monitor.md).

**Recovery:** `recovery/parametric/assessment.ts` calculates eligibility, distance, bands, contributions and caps independently of React, MapLibre, clock and storage. `packets.ts` owns immutable evaluations, lineage and canonical serialization. `repository.ts` and `useEvaluationLifecycle.ts` coordinate versioned IndexedDB and state publication after durable transactions. Delivery's model and storage adapter implement the simulated local receiver, stable submission identities, acknowledgements and complete replacements. Downloaded and submitted packet JSON remains identical. Recovery-only fixtures, formatting, UI and styling stay under `recovery/`; common observation schemas and historical evidence metadata stay under `events/`.

**Map:** `maps/WorkbenchMap.tsx` has two real callers: the main workbench and Portfolio. It owns MapLibre lifetime, shared geography, appearance, projection, terrain and camera behavior. Exposure's `useExposureMap.ts`, Recovery's `useRecoveryMap.ts` and Monitor's renderer own their sources, layers and interactions. Camera fit/focus ordering remains in the host where the shared behavior is coordinated. Renderer extraction preserves layer order and map identity rather than adding a second rendering system.

**Shared presentation:** `components/LocationTableLayout.tsx` owns the insured-location split layout; controls and preferences retain each workspace's state. `components/location-table.css` owns the common table frame, divider and expanded layout rules. `app/workbench.css` owns the shared shell; feature styles retain feature-specific presentation and responsive/print overrides. `WorkbenchDialog` provides accessible modal focus trapping, dismissal and focus return within each workspace's styling context.

## Dependency enforcement

`npm run check:architecture` runs `scripts/check-architecture.mjs`, and `npm run check` includes it. The checker parses production TypeScript/JavaScript imports and resolves local modules using project compiler settings, including Vite root-relative imports. It checks static imports, re-exports, import-type queries, literal dynamic imports and require forms; unresolved local or computed imports fail explicitly. Tests and declaration files are excluded.

The rules implement focused enforcement:

- Feature and shared modules cannot import application internals. Only the two browser entrypoints may import `app/mount`.
- Runtime applications cannot import each other's internals; `shared` cannot depend on application or tooling internals.
- Neutral event/browser modules remain independent of feature and presentation modules.
- Cross-feature imports use explicit existing data/helper allowances. Portfolio still uses Exposure's inventory models/helpers; Monitor and Recovery retain approved data dependencies. Selected model dependencies are type-only. The shared map host has a specific renderer-composition allowance.
- Runtime import cycles fail. Type-only edges still undergo ownership checks but do not form runtime cycles.

The allowlists in the checker are the exact source of truth. This deliberately retains existing shared portfolio/location dependencies; it does not claim strict feature isolation. A new dependency needs an ownership decision and a fixture proving the intended rule. Checker tests exercise both approved imports and rejected bypasses.

## Development and verification

Use Node 24+, Python 3.9+ for packaging/launching, and installed Playwright browsers for browser checks. Install root workspace dependencies and the archive's separate dependency set before full verification.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run dev:all` | Browser app alone / app with optional localhost monitoring backend |
| `npm run check` | Architecture rules, workspace types and browser-test types |
| `npm test` | Shared, frontend and backend tests |
| `npm run test:tooling` | Architecture and deployment-tool fixture tests |
| `npm run verify` | All type checks, workspace/archive unit/tooling tests, frontend build and archive Wrangler dry-run build; no deployment |
| `npm run test:e2e` | Development browser journeys, including layout, lifecycle and workspace retention |
| `npm run package:offline` | Build and package `release/catlas-offline.zip` with notices, evidence and digest manifest |
| `npm run test:offline` | Extract that exact zip, verify manifest digests and run production browser journeys through its Python launcher |

`verify` excludes the archive's two opt-in PostgreSQL HTTP suites. Their disposable local database setup is documented in the archive README. Browser and backend HTTP checks require localhost socket access. Tests through lifecycle, session, storage and presentation interfaces protect behavior; browser checks cover persistent map identity, retained workspace state, responsive tables and print behavior.

## Evidence and licensing

Raw USGS responses, selected product/origin/magnitude identifiers, aliases and measured source digests remain unchanged. The capture manifest distinguishes per-file completion, manifest preparation, event occurrence and product times. Summary `mw` is used literally; preserved XML `Mw` and origin linkage are not normalized to determine eligibility. Replay is not an as-of-event reconstruction.

Packaging copies runtime dependency LICENSE/NOTICE texts, including transitive dependencies, to `THIRD_PARTY_NOTICES.md`; MurmurHash's full MIT text is retained from its README. For the pinned scroll-bar package whose npm tarball omits its notice, a local supplemental upstream notice and its provenance are recorded in `scripts/licenses/README.md`; packaging requires no license downloads. Natural Earth land is public domain; source and USGS credits remain in CREDITS.txt. No external fonts, sprites, satellite assets or remote scripts are needed. ZIP entry timestamps are normalized container metadata; measured packaging time and file hashes are recorded separately in release-manifest.json.

## Distribution

The loopback Python launcher serves the extracted bundle on `http://127.0.0.1:4178`. Changing hostname, port, browser/profile or switching to hosted Pages changes the local-history origin. Explicit reset clears browser demo/receiver data and leaves packaged evidence untouched. Export portfolios and cases for portable backups; the public archive does not store insured inventories or local investigation history.

The packaging manifest reads `frontend/src/events/evidence-manifest.json`; captured artifact bytes and stored browser formats remain unchanged by the file reorganization. ZIP timestamps are container metadata, separate from recorded capture and packaging times.

See the [offline instructions](catlas-offline.md), [presenter walkthrough](catlas-presenter.md), [Cloudflare procedure](catlas-cloudflare.md) and [verification report](catlas-verification.md). Hosting credentials are never packaged. Local checks establish internal consistency and operability, not hosted release status, authenticated financial approval or customer validation.
