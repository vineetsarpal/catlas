# Monitor data sources and integration notices

Monitor is a situational view with optional backend connectivity. It does not establish affected exposure, damage, loss or contractual recovery. Wind and live vessel monitoring require the Catlas backend (CAT-35); earthquake and cyclone discovery run in the browser.

- **USGS earthquakes:** rolling past-day public GeoJSON, checked once per minute while Monitor is visible and online. https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson . Capture into Exposure explicitly retrieves source details and supported ShakeMap evidence. Event publication time is distinct from occurrence time.
- **NOAA/NWS NHC / CPHC:** tropical weather summary ArcGIS service, checked every five minutes. Atlantic and eastern/central North Pacific coverage only. https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer . Layers 5/6/7 supply positions, forecast tracks and cones. Geometry is paired by storm ID and advisory number. GIS file-update time is labelled separately from the advisory's source text. A center-track cone is not a wind footprint. No endorsement implied. https://www.weather.gov/disclaimer
- **NOAA/NCEP Global Forecast System (GFS):** keyless public numerical 10 m wind forecasts from https://noaa-gfs-bdp-pds.s3.amazonaws.com . The Catlas backend selects a recent six-hour run with a five-hour publication lag and downloads only UGRD/VGRD message byte ranges from one `pgrb2.1p00` forecast object. Source documentation: https://www.nco.ncep.noaa.gov/pmb/products/gfs/ . Data courtesy of NOAA/NCEP; no endorsement implied. The model run, forecast valid time and 1° source grid are explicit. Accelerated trail animation does not advance time or represent tracked air parcels. Optional shading is wind speed, in knots, from the same field.

## Backend decoder

`@meri-imperiumi/eccodes-wasm` 2.48.2 supplies ecCodes decoding in a disposable Node worker on the backend. The package is Apache-2.0 licensed. Source: https://github.com/meri-imperiumi/eccodes-wasm . The browser and offline download do not redistribute the decoder, its runtime or WASM assets.

The backend acquires, validates and caches forecast grids. The browser checks the returned metadata, binary length and vector values, retains a bounded five-minute session cache, and renders the field. Wind requires backend connectivity; there is no direct browser acquisition or decoding fallback. No persistent forecast archive is maintained.

## God's Eye View

Source reviewed at commit `de2138e84c1778fd98a48b7c9fd0b9788c318946`:
https://github.com/bilawalsidhu/gods-eye-view/tree/de2138e84c1778fd98a48b7c9fd0b9788c318946

The wind implementation was additionally reviewed in the local upstream checkout at commit `e8b3a10a07f3f7b31feb0ecea146a01c6fa2e36b`. `src/layers/wind/model.js` and `src/layers/wind/streamlines.js` inform seam-wrapped bilinear wind sampling and bounded geographic streamline integration. Catlas implements the projected canvas rendering for MapLibre; the Cesium renderer is not imported.

`server/providers/cyclones.js` informs the NOAA endpoints, fixed GIS layer selection and matching of storm/advisory identifiers. Catlas adapts that integration pattern to direct browser GIS queries with its own TypeScript/Zod validation and MapLibre presentation. The upstream CurrentStorms endpoint and wind GRIB decoding depend on its server; Catlas uses browser-direct NOAA GIS for cyclones and backend S3 range requests with a Node worker for wind. No Cesium application shell, upstream datasets, models or imagery are imported.

God's Eye View source is MIT licensed, copyright (c) 2026 Bilawal Sidhu. The full upstream notice, including its third-party-data exclusions, is retained in [licenses/gods-eye-view-LICENSE.txt](./licenses/gods-eye-view-LICENSE.txt). The MIT source license does not license third-party data.
