import { z } from 'zod';
import { earthquakeSchema, type CapturedEvidence, type Earthquake } from './model';
import { captureEvidence, readTextResponse } from './evidence';

export const LIVE_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const featureSchema = z.object({ id: z.string(), properties: z.object({ mag: z.number().nullable(), place: z.string().nullable(), time: z.number(), updated: z.number() }), geometry: z.object({ coordinates: z.array(z.number()).min(2) }) });
function eventFeature(value: unknown): Earthquake {
  const feature = featureSchema.parse(value);
  return earthquakeSchema.parse({ id: feature.id, name: feature.properties.place || feature.id, magnitude: feature.properties.mag,
    longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1], occurredAt: new Date(feature.properties.time).toISOString(), updatedAt: new Date(feature.properties.updated).toISOString() });
}
export async function discoverEarthquakes(signal?: AbortSignal): Promise<{ events: Earthquake[]; checkedAt: string; rejected: number }> {
  const response = await fetch(LIVE_FEED, { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(20_000)]), cache: 'no-cache' });
  const snapshot = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()).max(10_000) }).parse(JSON.parse(await readTextResponse(response, 8 * 1024 * 1024)));
  const events: Earthquake[] = []; let rejected = 0;
  for (const feature of snapshot.features) { try { events.push(eventFeature(feature)); } catch { rejected++; } }
  return { events: events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), checkedAt: new Date().toISOString(), rejected };
}
const productSchema = z.object({ id: z.string(), source: z.string(), code: z.string(), updateTime: z.number(), status: z.string(), preferredWeight: z.number().optional(), contents: z.record(z.string(), z.object({ url: z.string().url() }).passthrough()) }).passthrough();
export type LiveCapture = { event: Earthquake; evidence: CapturedEvidence | null; reason: string | null };
export async function acquireEarthquake(id: string, signal?: AbortSignal): Promise<LiveCapture> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Enter a USGS event ID, for example ci38457511.');
  const requestSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60_000)]);
  const detailUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(id)}`;
  const response = await fetch(detailUrl, { signal: requestSignal, cache: 'no-cache' });
  const detailText = await readTextResponse(response, 8 * 1024 * 1024);
  const detail = JSON.parse(detailText);
  const event = eventFeature(detail);
  const aliases = typeof detail.properties?.ids === 'string' ? detail.properties.ids.split(',').filter(Boolean) : [];
  const candidates = z.array(z.unknown()).max(200).parse(detail.properties?.products?.shakemap ?? []);
  const products = candidates.flatMap(value => { const parsed = productSchema.safeParse(value); return parsed.success && parsed.data.status === 'UPDATE' ? [parsed.data] : []; });
  products.sort((a, b) => (b.preferredWeight ?? 0) - (a.preferredWeight ?? 0) || b.updateTime - a.updateTime || a.id.localeCompare(b.id));
  const selected = products[0];
  if (!selected) return { event, evidence: null, reason: 'USGS has not published a supported active ShakeMap for this earthquake. Location intensity is unknown.' };
  const url = selected.contents['download/grid.xml']?.url;
  if (!url || new URL(url).origin !== 'https://earthquake.usgs.gov') return { event, evidence: null, reason: 'The selected ShakeMap has no supported USGS numeric MMI grid. No exposure amount is asserted.' };
  const rawXml = await readTextResponse(await fetch(url, { signal: requestSignal }));
  const evidence = await captureEvidence(rawXml, {
    eventId: event.id, aliases, eventName: event.name, magnitude: event.magnitude, longitude: event.longitude, latitude: event.latitude,
    occurredAt: event.occurredAt, productId: selected.id, provider: selected.source, productUpdatedAt: new Date(selected.updateTime).toISOString(), capturedAt: new Date().toISOString(),
    sourceUrl: url, retrospective: selected.source.toLowerCase().includes('atlas'),
  }, undefined, { url: detailUrl, text: detailText });
  return { event, evidence, reason: null };
}
