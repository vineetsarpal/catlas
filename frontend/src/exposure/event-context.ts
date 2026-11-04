import type { EventInput } from '../events/model';
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
