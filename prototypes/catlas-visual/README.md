# Catlas visual prototype — throwaway

Question: how could God's Eye View's globe, layer controls and selected-object panels support Catlas's earthquake-to-recovery workflow?

Run from the repository root:

```sh
python3 -m http.server 8765 --directory prototypes/catlas-visual
```

Open http://localhost:8765/?variant=A. Use the bottom switcher or arrow keys:

- A: globe-led event workbench.
- B: portfolio-led workspace with a map and compact recovery summary.
- C: recovery review with a supporting map.

Select scenarios, move between initial/revised evidence, toggle map layers, switch 2D/3D, and preview/download the mock handoff packet. All event observations, contracts, calculations and exposures are illustrative. The 150 km circle is a contract boundary, not a shaking footprint. The illustrative 82 km distance is a fixture, not computed from display coordinates. Layer 02/03 in B are static comparison fixtures. No production implementation, real treaty evaluation or RAS connection exists.

Visual inspiration: https://github.com/bilawalsidhu/gods-eye-view. This prototype independently implements a dark spatial workspace; no upstream source or bundled assets were copied. Uses CesiumJS 1.124 via CDN, Esri World Imagery with on-map attribution, and Google Fonts. Internet is required for the map and fonts. Basemap imagery is not current event evidence. No data persistence.

No layout verdict has been reached; these variants are for user review. Branch: codex/catlas-visual-prototype. Relevant planning issue: CAT-7 (workbench layout and explanation flow).
