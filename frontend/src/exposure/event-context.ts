import type { EventInput } from '../domain/types';
import type { CapturedEvidence, Earthquake } from './model';

/** Transfer the selected observation; missing magnitude type stays unknown. */
export function recoveryEventFromExposure(event: Earthquake, evidence: CapturedEvidence | null): EventInput {
  let magnitudeType: string | null = null;
  if (evidence?.rawEventJson) {
    try {
      const detail = JSON.parse(evidence.rawEventJson);
      const sameId = detail.id === event.id || (typeof detail.properties?.ids === 'string' && detail.properties.ids.split(',').includes(event.id));
      if (sameId && detail.properties?.mag === event.magnitude && typeof detail.properties.magType === 'string') magnitudeType = detail.properties.magType;
    } catch { /* Older cases can lack a usable origin observation. */ }
  }
  return {
    schemaVersion: 1, id: event.id, name: event.name, magnitude: event.magnitude, magnitudeType,
    latitude: event.latitude, longitude: event.longitude, occurredAt: event.occurredAt,
    evidenceVersion: evidence?.manifest.eventDetailSha256 ?? evidence?.manifest.rawSha256 ?? event.updatedAt,
    provenance: { kind: 'captured', source: 'USGS', capturedAt: evidence?.manifest.capturedAt ?? event.updatedAt,
      sourceUrl: evidence?.manifest.eventDetailUrl ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(event.id)}`,
      shakingEvidenceHash: evidence?.manifest.rawSha256 ?? null },
  };
}
export function earthquakeFromRecovery(event: EventInput | null): Earthquake | null {
  if (!event?.id || !event.name || !event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt)) ||
    typeof event.latitude !== 'number' || Math.abs(event.latitude) > 90 ||
    typeof event.longitude !== 'number' || Math.abs(event.longitude) > 180) return null;
  return { id:event.id, name:event.name, occurredAt:event.occurredAt, updatedAt:event.occurredAt,
    latitude:event.latitude, longitude:event.longitude, magnitude:event.magnitude ?? null };
}
export function sameObservation(event: EventInput | null, earthquake: Earthquake): boolean {
  return Boolean(event && event.id === earthquake.id && event.magnitude === earthquake.magnitude &&
    event.latitude === earthquake.latitude && event.longitude === earthquake.longitude &&
    event.occurredAt && Date.parse(event.occurredAt) === Date.parse(earthquake.occurredAt));
}

export function sameRecoveryEvent(left: EventInput | null | undefined, right: EventInput | null | undefined): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]));
    return value;
  };
  return Boolean(left && right && JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)));
}
