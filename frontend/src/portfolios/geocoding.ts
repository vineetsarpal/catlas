import { z } from 'zod';
import { readBoundedStream } from '../exposure/evidence';

export type MapPoint = { longitude: number; latitude: number };
export type PlaceResult = MapPoint & { id: string; name: string; label: string };
const featureSchema = z.object({
  geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]) }),
  properties: z.object({ name: z.string().max(500).optional(), street: z.string().max(500).optional(), housenumber: z.string().max(100).optional(), city: z.string().max(500).optional(), state: z.string().max(500).optional(), country: z.string().max(500).optional() }),
});
export function parsePlaces(raw: unknown): PlaceResult[] {
  const collection = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()).max(20) }).parse(raw);
  const seen = new Set<string>();
  return collection.features.flatMap((feature, index) => {
    const parsed = featureSchema.safeParse(feature); if (!parsed.success) return [];
    const { properties: p, geometry: { coordinates: [longitude,latitude] } } = parsed.data;
    const street = [p.housenumber,p.street].filter(Boolean).join(' ');
    const name = p.name || street || p.city || p.state || p.country;
    if (!name) return [];
    const label = [...new Set([name,street,p.city,p.state,p.country].filter(Boolean))].join(', ');
    const key = `${label}:${longitude},${latitude}`;
    if (seen.has(key)) return []; seen.add(key);
    return [{ id: `${index}:${key}`, name, label, longitude, latitude }];
  });
}
const cache = new Map<string, PlaceResult[]>();
let lastRequest = -Infinity;
function waitForSlot(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
    signal.addEventListener('abort',abort,{once:true});
  });
}
export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceResult[]> {
  const text = query.trim();
  if (text.length < 3 || text.length > 200) throw new Error('Enter a place or address between 3 and 200 characters.');
  if (!navigator.onLine) throw new Error('Place search is unavailable offline. Drop a pin or enter coordinates instead.');
  const endpoint = import.meta.env.VITE_CATLAS_GEOCODER_URL || 'https://photon.komoot.io/api/';
  const url = new URL(endpoint, location.origin);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Place search requires an HTTPS Photon endpoint.');
  const key = `${url.href}:${text.toLowerCase()}`;
  if (cache.has(key)) return structuredClone(cache.get(key)!);
  while(Date.now()-lastRequest<1000)await waitForSlot(1000-(Date.now()-lastRequest),signal);
  signal.throwIfAborted();
  lastRequest = Date.now();
  url.searchParams.set('q',text); url.searchParams.set('limit','5'); url.searchParams.set('lang','en');
  const response = await fetch(url, { signal: AbortSignal.any([signal,AbortSignal.timeout(10000)]), credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Place search unavailable (${response.status}). Try again or drop a pin.`);
  if (!response.body) throw new Error('Place search returned an empty response.');
  const bytes = await readBoundedStream(response.body,512_000);
  let result: PlaceResult[];
  try { result=parsePlaces(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))); }
  catch { throw new Error('Place search returned an unsupported response. Try again or drop a pin.'); }
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  cache.set(key,result);
  return structuredClone(result);
}
