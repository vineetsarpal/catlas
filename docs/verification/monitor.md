# Monitor verification

Initial Monitor implementation verified locally on 2026-10-19 (America/Toronto). Implementation: CAT-36; deferred vessel backend: CAT-35. No production deployment was performed.

- TypeScript/Vite production build and offline packaging passed. The existing large-chunk build advisory remains.
- Vitest: 120 passed, one optional actual-grid diagnostic skipped. Added checks cover cyclone advisory mismatch, missing geometry, stale/truncated/invalid responses, bounded forecast intervals, exact whole-second WMS run/valid-time requests and dateline proximity.
- Existing desktop/mobile browser suite: 64 passed. Final shared-workspace checks were rerun after integration refinements: 4 passed.
- Extracted offline browser suite: 8 passed, covering the existing exposure/recovery workflows and external-request boundaries.
- Playwright CLI with Chrome verified real browser requests to USGS, NOAA GIS and ECCC GeoMet. Actual global wind speed shading and arrows rendered after validating provider restrictions (one layer per image, whole-second ISO timestamps). This is an observation, not a provider availability guarantee.
- Checked desktop at 1280×720 and mobile at 375×812. No document overflow on mobile. Location inspection is available through a keyboard-accessible Locations list in addition to map points.
- Watched a live earthquake, reloaded and confirmed the local watch reference persisted. The wind layer preference also persisted.
- Captured real USGS event ci41349439 from Monitor into Exposure. At verification time no supported ShakeMap was published; all 18 synthetic portfolio locations were shown with unknown intensity, not zero.
- Browser back navigation returned to Monitor. Simulated offline state showed paused/stale messaging and hid wind imagery while retaining observations.
- Simulated a failed USGS discovery refresh: unavailable messaging appeared and earlier data remained. Returning to Exposure retained the existing 18-unknown-location investigation.

Screenshots remain local/untracked under output/playwright/. Source provenance, licensing and product limits are documented in docs/catlas-monitor.md and public/monitor-sources.md. Cyclone coverage is NHC/CPHC's Atlantic and eastern/central North Pacific coverage. Wind is a forecast, not a measured site intensity. Watchlists/preferences are browser-local. No vessel monitoring, backend, shared storage or marine exposure calculation was added.

## Animated wind trial — 2026-10-19

The GFS streamline trial supersedes the initial ECCC WMS wind presentation above. It uses direct NOAA S3 inventory/range requests and a pinned ecCodes WASM decoder in a disposable worker.

- Vitest: 122 passed, one optional actual-grid diagnostic skipped. New checks cover run/range validation, rejection of full-file/short/oversized bodies, bilinear sampling and longitude wrapping.
- Existing desktop/mobile browser suite: 62 passed on the first run; both timed-out desktop cases passed when rerun with one worker. The initial run competed with the offline suite; the failures were timeouts.
- Extracted offline browser suite: all eight passed with one worker after the concurrent run had four failures.
- Real browser data rendered moving streamlines on the shared Catlas map in Mercator and globe views, with light/dark appearance and optional speed shading. Pause/resume worked. Selecting another forecast removed the old canvas while loading; the replacement field matched the selected valid time. Switching to Exposure removed the canvas.
- The compressed decoder is 6,784,697 bytes. One real desktop browser decode/initialization observation was 1,829 ms; a subsequent task was 881 ms. These are local observations, not performance guarantees. Physical mobile wind performance and reduced-motion behavior have not been manually verified. Existing mobile workflow tests still pass.
- Final TypeScript/Vite build and offline packaging passed (archive 14,973,911 bytes). All four shared-workspace desktop/mobile checks passed after the final Regional-button refinement. The existing large-chunk advisory remains.
- The final screenshot is local/untracked: `output/playwright/monitor-wind-trial.jpg`.

No backend, vessel integration, production deployment or saved wind evidence was added.

## Wind control placement — 2026-10-20

Moved the wind layer toggle, pause/shading preferences, forecast selector, run label and speed legend into the map’s Layers & appearance menu. Removed the duplicate sidebar controls; feed freshness remains in Layers & feeds. The menu scrolls within a bounded height. Production build passed; browser checks verified toggling off removes the canvas and forecast controls, toggling on restores them, and pause/resume updates the shared toolbar. Screenshot: `output/playwright/wind-layers-appearance.jpg`.

## Unified layer switches — 2026-10-20

Consolidated earthquakes, tropical cyclones, insured locations and wind into Layers & appearance. Each accessible switch reveals its own details only while enabled; duplicate sidebar toggles were removed and the status tab is now named Feeds. Browser verification switched all four off (zero detail paragraphs and no wind canvas), then enabled wind (its options returned) and restored the other layers. The single-column menu scrolls within its height limit. TypeScript/Vite build and diff whitespace check passed. Screenshot: `output/playwright/monitor-layer-switches.jpg`.

## Globe view control — 2026-10-20

Replaced the World globe toolbar button with a Globe view switch in Layers & appearance across the shared map. Turning it off restores Mercator without world copies. Regional and portfolio-fit actions update the switch to off. Build/offline packaging passed; 10 targeted desktop/mobile map and reviewed-packet checks passed. Browser verification confirmed both globe and flat presentations. Screenshot: `output/playwright/globe-view-toggle.jpg`.

## Separate Layers and Appearance — 2026-10-20

Replaced the combined menu with two map controls. Layers owns overlay switches, wind options and the appropriate fit action; Appearance owns light/dark styling, globe projection, borders and labels. Opening one closes the other. Removed the separate map toolbar, including its duplicate pause shortcut; wind pause remains with wind options. The Regional button was also removed during review. Build and packaging passed; 10 relevant desktop/mobile browser checks and two extracted-offline map acceptance checks passed. Visual proof: `output/playwright/map-layers-menu.jpg` and `output/playwright/map-appearance-menu.jpg`.

## Portfolio-first layers and active legend — 2026-10-20

Insured locations is first in Monitor’s Layers menu, with Fit portfolio nested underneath while enabled. Monitor’s legend follows the same order and omits disabled overlays; it disappears when all three keyed overlays are off. Browser checks toggled earthquakes, cyclones and locations off in sequence and verified the corresponding legend entries disappeared, then restored the initial enabled layers. Build and whitespace checks passed. Screenshot: `output/playwright/portfolio-first-active-legend.jpg`.

## Default globe and horizontal flat panning — 2026-10-20

The shared map now starts with globe projection and its Appearance switch enabled. Flat projection allows longitude wrapping, with a viewport-diagonal minimum zoom updated on resize so the view does not show repeated regions. This replaces the earlier renderWorldCopies=false approach that locked horizontal movement at world scale. Wind integration retains unwrapped longitudes so streamlines cross the date line.

Fourteen relevant desktop/mobile browser checks passed, including new assertions for default globe and horizontal keyboard movement at low flat zoom. Three wind unit tests passed. Browser drag verification reached longitude 172.18° across the Pacific without blank margins; wind trails rendered across the date line. Screenshots: `output/playwright/flat-map-horizontal-pan.jpg` and `output/playwright/default-globe-view.jpg`.

## Header workspace navigation — 2026-10-20

Moved Monitor, Exposure and Recovery into the top header beside the Catlas brand. The active workspace is underlined; the shared Portfolio action is on the right. Removed the secondary mode row and duplicate case-header Portfolio actions. Navigation still uses the existing mode transition and preserves the shared map/investigation state. Build passed and 14 relevant desktop/mobile exposure and shared-workspace browser checks passed, including portfolio access and mobile overflow checks. Browser switching back to Monitor was visually verified. Screenshot: `output/playwright/top-workspace-navigation.jpg`.

## Backend-only wind (20 October 2026)

Supersedes the browser-decoder observations above. Wind discovery, NOAA acquisition and ecCodes decoding now require the Catlas backend. Removed the browser worker, decoder asset plugin and frontend ecCodes dependency. The browser still validates the returned grid, samples it and renders streamlines. A standalone build keeps Wind disabled with “Wind requires the Catlas backend.” Retained wind preferences make no wind requests in that build. Backend failures report unavailable and can retry without direct NOAA fallback.

Validation: workspace type checks and production build passed; 130 frontend tests passed (one optional diagnostic skipped), two shared tests and five backend tests passed. Desktop/mobile browser checks passed for standalone wind, metadata/grid failure, retry, successful rendering, disabling flow and persistent-map exposure/recovery transitions (eight checks across both build modes). The offline archive built successfully, contains no wind decoder or WASM assets, and passed all eight extracted-offline acceptance checks. Browser checks used installed Chrome and controlled backend responses; no live NOAA acquisition or client performance measurement was performed for this change.

### Live NOAA follow-up (20 October 2026, 11:09 EDT)

Verified the running localhost backend against real NOAA GFS data. Discovery selected the 2026-10-20 06:00 UTC run with 15:00 UTC default valid time. The default grid returned 65,160 finite U/V pairs (521,280 bytes); a repeat returned identical bytes. An additional uncached 48-hour forecast, valid 2026-10-22 06:00 UTC, was acquired and decoded successfully: 919 ms observed request time, including 285 ms decoding. Its acquisition timestamp confirmed fresh work, rather than a cache-only check. These are single local observations, not latency guarantees.

A backend-enabled frontend on localhost:4184 then rendered the real default forecast in the in-app browser: 660 wind paths and advancing painted frames, with the matching model-run and valid-time attributes. No provider mocks were used. Browser decoder assets remain absent. Machine-local check output and screenshot are `/tmp/catlas-live-noaa-wind-check.json` and `/tmp/catlas-live-noaa-wind.png`.
