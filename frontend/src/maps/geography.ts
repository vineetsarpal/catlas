import type { Map, StyleSpecification, LayerSpecification } from 'maplibre-gl';

export type GeographyVisibility = { countries: boolean; states: boolean; labels: boolean };
export type MapTheme = 'light' | 'dark';
const asset = (name: string) => new URL(`${import.meta.env.BASE_URL}map/${name}`, document.baseURI).href;
const lineIds = ['country-boundaries', 'state-boundaries'];
const labelIds = ['country-labels', 'state-labels', 'city-labels'];

function geographyLayers(theme: MapTheme): LayerSpecification[] {
  const light = theme === 'light';
  const labelPaint = { 'text-color': light ? '#465d6c' : '#bdcdd5', 'text-halo-color': light ? '#f7f7f0' : '#192c38', 'text-halo-width': 1.5 };
  return [
    { id: 'country-boundaries', type: 'line', source: 'country-boundaries', paint: {
      'line-color': light ? '#7e929b' : '#7e969f',
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, .6, 5, 1.2, 10, 1.8], 'line-opacity': .8,
    } },
    { id: 'state-boundaries', type: 'line', source: 'state-boundaries', minzoom: 3, paint: {
      'line-color': light ? '#8c9ca5' : '#708893',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, .5, 7, 1], 'line-opacity': .65, 'line-dasharray': [3, 2],
    } },
    { id: 'country-labels', type: 'symbol', source: 'country-labels', maxzoom: 5, layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 4, 15],
      'text-max-width': 9, 'text-letter-spacing': .08, 'symbol-sort-key': ['get', 'rank'], 'text-padding': 12,
    }, paint: labelPaint },
    { id: 'state-labels', type: 'symbol', source: 'state-labels', minzoom: 3.5, layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 10, 7, 13],
      'text-letter-spacing': .08, 'symbol-sort-key': ['get', 'rank'], 'text-padding': 8,
      'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 1,
    }, paint: { ...labelPaint, 'text-opacity': .85 } },
    { id: 'city-labels', type: 'symbol', source: 'city-labels', minzoom: 5, layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
      'symbol-sort-key': ['get', 'rank'], 'text-padding': 8, 'text-anchor': 'top', 'text-offset': [0, .4],
    }, paint: labelPaint },
  ];
}

export function contextMapStyle(theme: MapTheme, backgroundId = 'background'): StyleSpecification {
  const light = theme === 'light';
  return {
    version: 8,
    'font-faces': { 'Noto Sans Regular': asset('NotoSans-Regular.ttf') },
    sources: Object.fromEntries(['land', ...lineIds, ...labelIds].map(id => [id, {
      type: 'geojson' as const, data: asset(`${id}.geojson`),
      attribution: id === 'land' ? 'Natural Earth · geographic context' : undefined,
    }])),
    layers: [
      { id: backgroundId, type: 'background', paint: { 'background-color': light ? '#dce8ef' : '#172731' } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': light ? '#f6f5ee' : '#263b43', 'fill-outline-color': light ? '#a4b5bd' : '#4c6268' } },
      ...geographyLayers(theme),
    ],
  };
}

export function setGeographyTheme(map: Map, theme: MapTheme) {
  for (const layer of geographyLayers(theme)) {
    for (const [property, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, property as Parameters<Map['setPaintProperty']>[1], value);
  }
}

export function setGeographyVisibility(map: Map, visibility: GeographyVisibility) {
  for (const [id, visible] of [
    ['country-boundaries', visibility.countries], ['state-boundaries', visibility.countries && visibility.states],
    ['country-labels', visibility.labels],
    ['state-labels', visibility.labels], ['city-labels', visibility.labels],
  ] as const) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

// Captures actual drawn geographic context for offline/browser verification.
export function renderedGeography(map: Map) {
  return {
    boundaries: map.queryRenderedFeatures({ layers: lineIds }).length,
    labels: [...new Set(map.queryRenderedFeatures({ layers: labelIds }).map(feature => String(feature.properties.name)))],
  };
}
