import { z } from 'zod';
import { earthquakeSchema, type Earthquake } from './model';
import { readTextResponse } from './evidence';

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
