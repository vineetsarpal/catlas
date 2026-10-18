# Event and exposure investigation

Open `exposure.html` from the hosted/local distribution, or follow **Investigate portfolio exposure** from the recovery workbench. The original recovery application remains at `index.html`; exposure cases use a separate IndexedDB database and never alter recovery evaluations, reviewed packets or simulated RAS delivery records.

## Analyst journey

1. Choose **Investigate Ridgecrest replay** to start with frozen evidence and 18 labelled fictional locations/values. Expected threshold-4 result: 11 locations meet the screening threshold, 5 are below it, 2 have unknown intensity. Known screened value is USD116m and CAD12m separately; one screened location has unknown value.
2. Inspect the map or a table row. Numeric MMI is estimated by bilinear interpolation of surrounding grid nodes, not distance to the epicentre or a display contour. The map image is regional context. Neither shaking nor insured value asserts property damage, a claim, or reinsurance recovery.
3. Filter locations or a currency. Counts and value totals describe the full assessed portfolio at the saved threshold; table/map filters change the view only. The table pages 100 rows at a time; CSV exports every assessed row.
4. Apply a changed threshold to create a new investigation version. Save versions explicitly to retain them locally; refresh opens a clean selection with saved history available. Opening a saved version retains its exact results rather than recalculating it using current source data.
5. Enable near-real-time USGS discovery while online. The all-day feed refreshes about once per minute while the page is visible. This is not an earthquake detection SLA. Choose an event or enter its USGS ID, then capture evidence. A supported ShakeMap may not exist yet; unavailable evidence produces unknown results, not a zero assessment.
6. Check for newer source evidence when needed. A new product is offered for explicit application as another version. Previously saved results remain unchanged. The current preferred product may be retrospective for older events; provider/source labels and timestamps make that distinction visible.
7. Download all-location CSV, print an impact summary, or download a self-contained case. Reopen the compressed case in another local browser history or the offline distribution; results are checked against bundled inputs before saving. Case files contain the supplied insured-location data.

## Portfolio imports

The first release supports 1–1,000 input locations and a 2MB CSV limit. Oversize inputs are rejected, never truncated. A separate 10,000-location calculation diagnostic is not an additional supported-capacity promise.

Use the downloadable template. Required columns: `location_id,name,longitude,latitude,total_insured_value,currency`. Optional columns: `region,business_line`. One row represents a consolidated insured location, not a policy. The exporting PAS/exposure system (or a sufficiently detailed RAS) must consolidate policies and supply coordinates. Catlas does not geocode addresses, merge sites or convert currencies.

Supply a source name and valid portfolio as-of date. That date describes the supplied snapshot, not proof of policy coverage at an earthquake's occurrence. A blank insured value is unknown; it is not zero. Values must be finite/nonnegative and currencies three uppercase letters. Duplicate location IDs block import. Distinct IDs at the same coordinates are retained with a warning. Invalid coordinates/rows are excluded in the preview; explicitly acknowledge the usable rows and exclusions before importing. The excluded count travels with the case and exports.

## Evidence and classification

The packaged full-resolution USGS atlas grid is `evidence/shaking/ridgecrest-grid.xml.gz`; original source: https://earthquake.usgs.gov/product/shakemap/ci38457511/atlas/1594160054783/download/grid.xml . Its decompressed SHA-256 is `f4fbcf36e9098963ddc2ea82656974c268b50df5dfdb49b9bf9ffae72ea8e306`. The parser reads named fields and actual longitude/latitude axes, validates rectangular north-first ordering and reverses rows for lookup. Supported grids contain at most 1.5m nodes and 64MB XML. Incompatible fields/units/layouts remain visible errors. Missing, nonfinite or out-of-range MMI samples are unknown; no outside-grid clamping or extrapolation occurs.

Sampler `bilinear-mmi-axes-1` interpolates numeric MMI in coordinate space. Exact nodes/edges require only nonzero-weight supporting samples. Classification uses full precision: default MMI≥4, bands <4, [4,5), [5,6), [6,7), ≥7. This is an adjustable Catlas investigation threshold, not a USGS damage rule. Priority is band, currency grouping, known value descending within the currency, then stable location ID. Unknown intensity stays in Needs investigation.

Live acquisition retains exact selected numeric XML plus captured USGS event-detail JSON, source identities/URLs and SHA-256 hashes. Event occurrence, event update, product update, processing and browser snapshot creation times are distinct. `capturedAt` identifies creation of the Catlas evidence snapshot; for packaged replay that is a local read of archived bytes, not a fresh USGS download or a reconstruction of the initial bulletin. The replay event-detail file retains its original capture manifest separately. Provider selection considers active current products, not a reconstructed historical timeline.

Only public earthquake IDs/product requests are sent to USGS. Portfolio locations, values and cases stay in browser storage. Discovery is opt-in and stops when disabled or hidden; source errors leave earlier feed data visibly stale. Captured investigations remain usable when the provider is unavailable. No backend or API key was required by the verified direct-browser USGS path.

## Retention and portable cases

Database `catlas-exposure-1` stores immutable investigation snapshots separately from content-addressed evidence. Portfolio/evidence hashes are checked on load/export/import. A `.json.gz` case contains the selected version, complete portfolio, settings, exact evidence XML/event-detail JSON and integrity hash. Import rejects unsupported schemas, altered hashes or results that do not reproduce. Hashes establish consistency, not authenticity or financial approval. Compressed bundles are limited to 32MB; decompression is bounded. Do not treat a changed filename or hash as a digital signature.

Opening a saved case does not request new evidence. Offline replay, local imports, saved-version reopen, CSV/print and complete portable-case import require no external networking when the application itself is served locally. New source discovery/capture requires connectivity. Hosted and offline origins have separate history. Deleting a case removes all its saved versions and unused evidence locally, after explicit confirmation.

The self-contained case represents one selected version. Its prior-version identity is retained, but it does not include all prior case versions. Download earlier versions separately if needed. New versions created from an older resumed snapshot link to the latest retained version to avoid a duplicate case/version identity.

## Validation and implementation

Source: `src/exposure/` contains typed portfolio/evidence/assessment boundaries, acquisition, immutable case storage, exports and the React workbench/MapLibre presentation. The earlier throwaway comparison was used to choose the foundation; no Cesium runtime, restricted upstream dataset, or whole Gods Eye View shell is included in this release.

Run `npm test`, `npm run test:e2e`, `npm run package:offline`, and `npm run test:offline` using an installed Chrome/Chromium binary as documented in README. Run `CATLAS_EXPOSURE_DIAGNOSTIC=1 npm test -- src/exposure/diagnostic.test.ts` for the separately labelled actual-grid diagnostic; output is `docs/verification/exposure-diagnostic.json`. These timings measure local calculation only, not browser rendering/FPS, a production SLA or customer validation. Release verification observations are recorded separately.

## Linked portfolio exploration

SpatialKey's [public product page](https://insurity.com/platform/spatialkey) was reviewed as a design reference on 2026-10-17. The relevant ideas are linked maps and financial context, portfolio concentration exploration, and progressive access to detail. Catlas adapts these patterns using its existing earthquake evidence and consolidated insured locations.

- Summary cards for meeting threshold, unknown intensity and below threshold act as view filters. Click the selected card again to return to all statuses.
- Search matches location names, IDs, regions and business lines. Region, business line, status and currency filters combine and apply to both map points and the paginated location list. A selected location outside the view is no longer presented as an inspected visible location.
- **Where to focus** ranks regions by the count meeting the saved threshold, then unknown intensity. Bars show the fraction of all locations in that region known to meet the threshold. Screened known insured values remain separate by currency; unknown intensity and unknown value are disclosed. Selecting a region filters the shared view. The regional breakdown and summary cards always describe the full assessment.
- **Fit visible locations**, light/dark basemaps, insured-location visibility, shaking visibility and opacity are presentation controls. They do not change evidence, threshold, results or saved investigation versions. The light map uses the same packaged Natural Earth land geometry; it does not add street-level detail or satellite imagery.
- All-location CSV and case exports retain the full assessed portfolio even when the current map/list view is filtered. Changing the investigation threshold still explicitly creates a new version.

These additions do not implement the reference product's advertised multi-peril data marketplace, underwriting moratorium engine or AI assistant.


## Country and state/province map context

Both workbenches use native MapLibre GeoJSON line and symbol layers for geographic context. No additional mapping package or map-service account is required. Country borders appear at world scale; state/province borders appear from zoom 3. Country labels yield to state/province labels from zoom 3.5, with selected city labels from zoom 5. Country borders, state/province borders and place labels have separate visibility controls.

Natural Earth source files are pinned by commit and SHA-256 in `public/map/geography-manifest.json`. The bundled land layer is now 1:50m; administrative lines are simplified for display by `scripts/prepare-map-geography.py`. Labels use the bundled Noto Sans font with its SIL OFL license, so borders and text work without external tile, glyph or font services. Natural Earth boundaries follow its geographic conventions and are generalized context, not authoritative legal boundaries, portfolio region assignments, or treaty zones. County boundaries are not included.
