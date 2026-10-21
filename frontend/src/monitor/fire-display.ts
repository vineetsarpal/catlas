import type { FirePerimeter, HazardGeometry } from '@catlas/shared/hazards';
import type { MonitorItem } from './model';

export const containmentBands = [
  { id: 'unknown', label: 'Unknown', color: '#788690' },
  { id: 'uncontained', label: '0% contained', color: '#c43c32' },
  { id: 'low', label: '>0–<50%', color: '#d96a22' },
  { id: 'partial', label: '50–<100%', color: '#ab7b15' },
  { id: 'contained', label: '100% contained', color: '#47825d' },
] as const;

export function containmentBand(value: number | null) {
  return containmentBands[value === null ? 0 : value <= 0 ? 1 : value < 50 ? 2 : value < 100 ? 3 : 4];
}

export function observationAge(at: string | null, now: number) {
  if (!at) return 'Time unknown';
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

/** Smallest longitude arc containing every polygon part, including across the dateline. */
export function perimeterBounds(geometry: HazardGeometry): [[number, number], [number, number]] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const points = polygons.flatMap(polygon => polygon[0]);
  const longitudes = points.map(([lon]) => (lon + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[(i + 1) % longitudes.length] + (i === longitudes.length - 1 ? 360 : 0);
    if (next - longitudes[i] > gap) { gap = next - longitudes[i]; start = (i + 1) % longitudes.length; }
  }
  let west = longitudes[start];
  if (west > 180) west -= 360;
  let south = 90, north = -90;
  for (const [, lat] of points) { south = Math.min(south, lat); north = Math.max(north, lat); }
  return [[west, south], [west + 360 - gap, north]];
}

/** Rendering works only on visible observations; it never feeds portfolio screening. */
export function fireDetectionFeatures(items: MonitorItem[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: 'FeatureCollection', features: items.filter(item => item.kind === 'fire' && item.mapOnly && item.hasPosition !== false).map(item => ({
    type: 'Feature', properties: { key: item.key },
    geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] },
  })) };
}

export function fireEvidenceLabel(fire:FirePerimeter) {
  return fire.evidence==='reported-incident'?'Reported fire location':fire.evidence==='estimated-perimeter'?'Estimated fire area':'Published fire perimeter';
}
export function fireSourceLabel(fire:FirePerimeter) {return fire.provider==='CWFIS'?'NRCan CWFIS · Canada':'NIFC WFIGS · United States';}
export function fireEvidenceTime(fire:FirePerimeter) {return fire.evidence==='estimated-perimeter'?fire.cwfis?.lastDetectedAt??null:fire.updatedAt;}
export function fireTimeLabel(fire:FirePerimeter) {return fire.evidence==='reported-incident'?'Status reported':fire.evidence==='estimated-perimeter'?'Last hotspot':'Boundary updated';}
