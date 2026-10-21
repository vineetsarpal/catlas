import * as maplibre from 'maplibre-gl';
import { fireDetectionFeatures } from './fire-display';
import type { MonitorItem } from './model';

const fireLayers = ['monitor-fire-glow', 'monitor-fire-dots', 'monitor-fire-clusters', 'monitor-fire-counts', 'monitor-fire-selected'];

export function addFireMapLayers(map: maplibre.Map, select: (key: string) => void) {
  map.addSource('monitor-fires', { type: 'geojson', data: fireDetectionFeatures([]), cluster: true, clusterRadius: 42, clusterMaxZoom: 7 });
  map.addSource('monitor-selected-fire', { type: 'geojson', data: fireDetectionFeatures([]) });
  const detectionFilter: maplibre.FilterSpecification = ['!', ['has', 'point_count']];
  map.addLayer({ id: 'monitor-fire-glow', type: 'circle', source: 'monitor-fires', filter: detectionFilter, paint: {
    'circle-radius': 15, 'circle-color': '#ed752f', 'circle-opacity': .5, 'circle-blur': .85,
  } }, 'monitor-items');
  map.addLayer({ id: 'monitor-fire-dots', type: 'circle', source: 'monitor-fires', filter: detectionFilter, paint: {
    'circle-radius': 4, 'circle-color': '#ffb553', 'circle-stroke-color': '#983b1e', 'circle-stroke-width': 1.2,
  } }, 'monitor-items');
  map.addLayer({ id: 'monitor-fire-clusters', type: 'circle', source: 'monitor-fires', filter: ['has', 'point_count'], paint: {
    'circle-radius': ['step', ['get', 'point_count'], 23, 100, 28, 1000, 34],
    'circle-color': '#a34523', 'circle-opacity': .94, 'circle-stroke-color': '#ffc982', 'circle-stroke-width': 2,
  } }, 'monitor-items');
  map.addLayer({ id: 'monitor-fire-counts', type: 'symbol', source: 'monitor-fires', filter: ['has', 'point_count'], layout: {
    'text-field': ['concat', ['get', 'point_count_abbreviated'], '\ndetections'], 'text-font': ['Noto Sans Regular'], 'text-size': 10,
    'text-allow-overlap': true,
  }, paint: { 'text-color': '#fff5e4' } }, 'monitor-items');
  // A selected observation remains visible even when its neighbors form a cluster.
  map.addLayer({ id: 'monitor-fire-selected', type: 'circle', source: 'monitor-selected-fire', paint: {
    'circle-radius': 8, 'circle-color': '#fff2bd', 'circle-stroke-color': '#b74d25', 'circle-stroke-width': 3,
  } }, 'monitor-items');
  const foregroundAt = (point: maplibre.Point) => map.queryRenderedFeatures(point, { layers: ['monitor-items', 'monitor-vessels', 'monitor-earthquake-labels'] }).length > 0;
  map.on('click', 'monitor-fire-dots', event => { if (foregroundAt(event.point)) return; const key = event.features?.[0]?.properties.key; if (key) select(String(key)); });
  map.on('click', 'monitor-fire-selected', event => { if (foregroundAt(event.point)) return; const key = event.features?.[0]?.properties.key; if (key) select(String(key)); });
  map.on('click', 'monitor-fire-clusters', async event => {
    if (foregroundAt(event.point)) return;
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== 'Point') return;
    const source = map.getSource('monitor-fires') as maplibre.GeoJSONSource;
    try {
      const zoom = await source.getClusterExpansionZoom(Number(feature.properties.cluster_id));
      if (map.getSource('monitor-fires') !== source || map.getLayoutProperty('monitor-fire-clusters', 'visibility') === 'none') return;
      const [lon, lat] = feature.geometry.coordinates;
      map.easeTo({ center: [lon, lat], zoom: Math.min(zoom, 9), duration: 350 });
    } catch { /* A feed refresh can replace a cluster while expansion is pending. */ }
  });
  for (const id of ['monitor-fire-dots', 'monitor-fire-selected', 'monitor-fire-clusters']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

export function updateFireMapLayers(map: maplibre.Map, items: MonitorItem[], selected: string, active: boolean) {
  const data = fireDetectionFeatures(active ? items : []);
  (map.getSource('monitor-fires') as maplibre.GeoJSONSource).setData(data);
  (map.getSource('monitor-selected-fire') as maplibre.GeoJSONSource).setData({ ...data, features: data.features.filter(feature => feature.properties?.key === selected) });
  for (const id of fireLayers) map.setLayoutProperty(id, 'visibility', active ? 'visible' : 'none');
}
