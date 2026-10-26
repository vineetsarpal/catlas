import { ArchiveError } from './types';
import { boundedBytes, EVENT_ID } from './provider';
export type CatalogEvent = { id: string; name: string; magnitude: number | null; latitude: number; longitude: number; occurredAt: string; updatedAt: string; aliases: string[]; significance: number | null };
const isoTime = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function feature(value: unknown): CatalogEvent {
  if (!record(value) || typeof value.id !== 'string' || !EVENT_ID.test(value.id) || !record(value.properties) || !record(value.geometry) || !Array.isArray(value.geometry.coordinates)) throw new Error('Unsupported event');
  const p = value.properties, coordinates = value.geometry.coordinates;
  const [longitude, latitude] = coordinates;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof p.time !== 'number' || !Number.isFinite(p.time) || typeof p.updated !== 'number' || !Number.isFinite(p.updated) || (p.mag !== null && (typeof p.mag !== 'number' || !Number.isFinite(p.mag)))) throw new Error('Unsupported event');
  const aliases = typeof p.ids === 'string' ? p.ids.split(',').filter(id => EVENT_ID.test(id)) : [];
  if (aliases.length > 100 || (typeof p.place === 'string' && p.place.length > 1000)) throw new Error('Unsupported event');
  return { id: value.id, name: typeof p.place === 'string' && p.place.trim() ? p.place : value.id, magnitude: p.mag, longitude, latitude, occurredAt: new Date(p.time).toISOString(), updatedAt: new Date(p.updated).toISOString(), significance: typeof p.sig === 'number' && Number.isFinite(p.sig) ? p.sig : null, aliases: [...new Set([value.id, ...aliases])] };
}
/** One bounded source request on explicit analyst action; catalog discovery never publishes evidence. */
export async function discoverCatalog(fetcher: typeof fetch, params: URLSearchParams) {
  for (const key of params.keys()) if (!['eventId', 'mode', 'start', 'significant', 'offset', 'end', 'minMagnitude', 'maxMagnitude', 'minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude'].includes(key) || params.getAll(key).length !== 1) throw new ArchiveError('invalid_request', 'Use only public catalog paging and significance fields.', 400);
  if (params.has('significant') && !['true', 'false'].includes(params.get('significant')!)) throw new ArchiveError('invalid_request', 'Catalog significance must be true or false.', 400);
  const historical = params.get('mode') === 'historical';
  if (params.has('mode') && !['recent', 'historical'].includes(params.get('mode')!)) throw new ArchiveError('invalid_request', 'Unsupported catalog mode.', 400);
  const eventId = params.get('eventId');
  const significant = params.has('significant') ? params.get('significant') === 'true' : !historical;
  const rawOffset = params.get('offset') ?? '0';
  const offset = Number(rawOffset);
  if (!/^\d{1,3}$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset % 50 !== 0 || offset > 450) throw new ArchiveError('invalid_request', 'Catalog pages must use offsets 0 through 450 in steps of 50.', 400);
  if (params.has('eventId') && (!historical || !EVENT_ID.test(eventId!) || offset !== 0 || [...params.keys()].some(key => !['mode', 'eventId', 'offset'].includes(key)))) throw new ArchiveError('invalid_request', 'Use a valid source ID without other discovery filters.', 400);
  const now = Date.now();
  const anchor = params.get('end');
  const endMs = anchor === null ? now : Date.parse(anchor);
  if (!historical && anchor !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(anchor) || !Number.isFinite(endMs) || endMs > now + 60_000 || endMs < now - 86_400_000)) throw new ArchiveError('invalid_request', 'Catalog continuation expired or is invalid. Refresh the recent catalog explicitly.', 400);
  const end = new Date(endMs), start = new Date(historical && !eventId ? Date.parse(params.get('start') ?? '') : endMs - 90 * 86_400_000);
  if (historical && !eventId && (!isoTime(params.get('start')) || !isoTime(anchor) || start > end)) throw new ArchiveError('invalid_request', 'Use a valid historical date range.', 400);
  const source = new URL('https://earthquake.usgs.gov/fdsnws/event/1/query');
  source.search = new URLSearchParams({ format: 'geojson', eventtype: 'earthquake', starttime: start.toISOString(), endtime: end.toISOString(), orderby: 'time', limit: '51', offset: String(offset + 1), minsig: '601' }).toString();
  if (!significant) source.searchParams.delete('minsig');
  const numericFields = { minMagnitude: 'minmagnitude', maxMagnitude: 'maxmagnitude', minLatitude: 'minlatitude', maxLatitude: 'maxlatitude', minLongitude: 'minlongitude', maxLongitude: 'maxlongitude' };
  for (const [key, upstream] of Object.entries(numericFields)) {
    const raw = params.get(key);
    if (raw !== null) {
      if (!historical || raw.length > 32 || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw))) throw new ArchiveError('invalid_request', 'Use finite historical numeric filters.', 400);
      source.searchParams.set(upstream, raw);
    }
  }
  const number = (key: string) => Number(params.get(key));
  if (params.has('minMagnitude') && params.has('maxMagnitude') && number('minMagnitude') > number('maxMagnitude')) throw new ArchiveError('invalid_request', 'Magnitude minimum exceeds maximum.', 400);
  const area = ['minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude'];
  if (area.some(key => params.has(key)) && (!area.every(key => params.has(key)) || Math.abs(number('minLatitude')) > 90 || Math.abs(number('maxLatitude')) > 90 || Math.abs(number('minLongitude')) > 360 || Math.abs(number('maxLongitude')) > 360 || number('minLatitude') >= number('maxLatitude') || number('minLongitude') >= number('maxLongitude') || number('maxLongitude') - number('minLongitude') > 360)) throw new ArchiveError('invalid_request', 'Use a complete valid geographic bounding box.', 400);
  if (!historical && params.has('start')) throw new ArchiveError('invalid_request', 'Historical filters require historical mode.', 400);
  if (eventId) source.search = new URLSearchParams({ format: 'geojson', eventid: eventId }).toString();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(source.href, { signal: controller.signal, redirect: 'manual', headers: { accept: 'application/geo+json, application/json' } });
    if (response.status === 429) throw new ArchiveError('provider_quota', 'USGS is limiting source requests. Retry explicitly later.', 503);
    if (response.status >= 300 && response.status < 400) throw new ArchiveError('source_redirect', 'Catalog redirects are not followed.', 502);
    if (!response.ok && !(eventId && response.status === 404)) throw new ArchiveError('source_unavailable', 'USGS catalog discovery failed. Retry explicitly; prior results may be stale.', 502);
    let data: unknown = response.status === 204 || (eventId && response.status === 404) ? { type: 'FeatureCollection', features: [] } : JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await boundedBytes(response.body, 8_388_608)));
    if (eventId && record(data) && data.type === 'Feature') data = { type: 'FeatureCollection', features: [data] };
    if (!record(data) || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 51) throw new ArchiveError('unsupported_catalog', 'The source returned an unsupported catalog response.', 502);
    const events: CatalogEvent[] = []; let rejected = 0;
    for (const value of data.features.slice(0, 50)) { try { const next = feature(value); if (!significant || (next.significance !== null && next.significance > 600)) {
      const matches = events.filter(existing => existing.aliases.some(alias => next.aliases.includes(alias)));
      const latest = [...matches, next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const aliases = [...new Set([...matches.flatMap(event => event.aliases), ...next.aliases])];
      for (const matched of matches) events.splice(events.indexOf(matched), 1);
      events.push({ ...latest, aliases });
    } } catch { rejected++; } }
    const sourceHasMore = data.features.length > 50;
    const hasMore = sourceHasMore && offset < 450;
    return { events: events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), checkedAt: new Date().toISOString(), range: { start: start.toISOString(), end: end.toISOString() }, offset, limit: 50, hasMore, completeness: rejected || (sourceHasMore && offset === 450) ? 'partial' : hasMore ? 'more-available' : 'complete', rejected };
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError('source_unavailable', 'USGS catalog discovery failed. Retry explicitly; prior results may be stale.', 502);
  } finally { clearTimeout(timer); controller.abort(); }
}
