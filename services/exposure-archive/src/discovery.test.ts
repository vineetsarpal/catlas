import { describe, expect, it, vi } from 'vitest';
import { createArchiveHandler } from './archive';
import type { ArchiveDependencies } from './types';
const TOKEN = 'catalog-test-token-at-least-32-characters';
const request = (search = '') => new Request(`https://proof.test/api/catalog${search}`, { headers: { authorization: `Bearer ${TOKEN}` } });
const event = (id: string, significance: number | null = 601, updated = 2000, aliases = `,${id},`) => ({ type: 'Feature', id, properties: { place: 'Same place', mag: 5.2, time: Date.now() - 1000, updated, sig: significance, ids: aliases }, geometry: { type: 'Point', coordinates: [-117, 35, 10] } });
function handler(features: unknown[]) {
  const deps = { database: {}, bucket: {}, providerFetch: async () => Response.json({ type: 'FeatureCollection', features }), rateLimit: async () => true } as unknown as ArchiveDependencies;
  return createArchiveHandler(deps);
}
describe('recent catalog HTTP interface', () => {
  it('uses the source ID when the catalog supplies an empty place description', async () => {
    const source = event('unnamed-source'); source.properties.place = '';
    const response = await handler([source])(request(), { PROOF_TOKEN: TOKEN });
    expect(await response.json()).toMatchObject({ events: [{ id: 'unnamed-source', name: 'unnamed-source' }], rejected: 0 });
  });

  it('treats source 204 as successful empty discovery and rejects source redirects', async () => {
    const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async () => new Response(null, { status: 204 }) } as unknown as ArchiveDependencies;
    const run = createArchiveHandler(deps);
    expect(await (await run(request(), { PROOF_TOKEN: TOKEN })).json()).toMatchObject({ events: [], completeness: 'complete' });
    deps.providerFetch = async () => new Response(null, { status: 302, headers: { location: 'https://outside.test/catalog' } });
    const redirect = await run(request(), { PROOF_TOKEN: TOKEN });
    expect(redirect.status).toBe(502);
    expect((await redirect.json() as { error: { code: string } }).error.code).toBe('source_redirect');
  });

  it('rejects source bytes beyond the bounded catalog response size', async () => {
    const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async () => new Response('x'.repeat(8_388_609)) } as unknown as ArchiveDependencies;
    expect((await createArchiveHandler(deps)(request(), { PROOF_TOKEN: TOKEN })).status).toBe(413);
  });

  it('ends a stalled source request at the catalog deadline without inventing empty results', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); entered(); }) } as unknown as ArchiveDependencies;
    const pending = createArchiveHandler(deps)(request(), { PROOF_TOKEN: TOKEN });
    try {
      await started; await vi.advanceTimersByTimeAsync(20_000);
      const response = await pending;
      expect(response.status).toBe(502);
      expect((await response.json() as { error: { code: string } }).error.code).toBe('source_unavailable');
    } finally { vi.useRealTimers(); }
  });

  it('retains the initial discovery window when requesting another page', async () => {
    const run = handler([event('anchored')]);
    const first = await (await run(request(), { PROOF_TOKEN: TOKEN })).json() as { range: { start: string; end: string } };
    const continued = await run(request(`?offset=50&end=${encodeURIComponent(first.range.end)}`), { PROOF_TOKEN: TOKEN });
    expect(continued.status).toBe(200);
    expect((await continued.json() as { range: unknown }).range).toEqual(first.range);
  });

  it('sends a bounded fixed-source query with a 90-day range and one-based source paging', async () => {
    const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const valid = url.origin === 'https://earthquake.usgs.gov' && url.pathname === '/fdsnws/event/1/query' && url.searchParams.get('limit') === '51' && url.searchParams.get('offset') === '51' && url.searchParams.get('minsig') === '601' && url.searchParams.get('orderby') === 'time' && Date.parse(url.searchParams.get('endtime')!) - Date.parse(url.searchParams.get('starttime')!) === 7_776_000_000 && init?.redirect === 'manual';
      return valid ? Response.json({ type: 'FeatureCollection', features: [event('bounded')] }) : new Response('Invalid source contract', { status: 400 });
    } } as unknown as ArchiveDependencies;
    expect((await createArchiveHandler(deps)(request('?offset=50'), { PROOF_TOKEN: TOKEN })).status).toBe(200);
  });

  it('distinguishes successful no matches from a source failure without exposing diagnostics', async () => {
    const empty = await handler([])(request(), { PROOF_TOKEN: TOKEN });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ events: [], completeness: 'complete' });
    const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async () => new Response('private source diagnostics', { status: 503 }) } as unknown as ArchiveDependencies;
    const failure = await createArchiveHandler(deps)(request(), { PROOF_TOKEN: TOKEN });
    expect(failure.status).toBe(502);
    expect((await failure.json() as { error: { code: string } }).error.code).toBe('source_unavailable');
  });

  it('rejects malformed rows and discloses partial source coverage instead of claiming complete results', async () => {
    const response = await handler([event('valid'), { id: 'malformed' }])(request(), { PROOF_TOKEN: TOKEN });
    expect(await response.json()).toMatchObject({ events: [{ id: 'valid' }], rejected: 1, completeness: 'partial' });
  });

  it('merges source-confirmed aliases using the newest revision but keeps same-place events distinct', async () => {
    const run = handler([event('old', 601, 2000, ',old,shared,'), event('new', 601, 3000, ',new,shared,'), event('separate', 601, 4000)]);
    const body = await (await run(request(), { PROOF_TOKEN: TOKEN })).json() as { events: { id: string; aliases: string[]; updatedAt: string }[] };
    expect(body.events).toHaveLength(2);
    const merged = body.events.find(event => event.id === 'new');
    expect(merged?.aliases).toEqual(expect.arrayContaining(['old', 'shared', 'new']));
    expect(merged?.updatedAt).toBe('1970-01-01T00:00:03.000Z');
    expect(body.events.some(event => event.id === 'separate')).toBe(true);
  });

  it.each(['?url=https://outside.test', '?portfolio=private', '?significant=yes', '?offset=0&offset=50', '?significant=true&significant=false'])('rejects unsupported catalog input %s', async search => {
    expect((await handler([])(request(search), { PROOF_TOKEN: TOKEN })).status).toBe(400);
  });

  it('bounds source pages and discloses more available results or the ten-page ceiling', async () => {
    const page = Array.from({ length: 51 }, (_, index) => event(`event-${index}`));
    const run = handler(page);
    const second = await run(request('?offset=50'), { PROOF_TOKEN: TOKEN });
    expect(await second.json()).toMatchObject({ offset: 50, limit: 50, hasMore: true, completeness: 'more-available' });
    const last = await run(request('?offset=450'), { PROOF_TOKEN: TOKEN });
    expect(await last.json()).toMatchObject({ offset: 450, hasMore: false, completeness: 'partial' });
    expect((await run(request('?offset=500'), { PROOF_TOKEN: TOKEN })).status).toBe(400);
  });

  it('applies Catlas significance strictly above 600 and allows removing the filter', async () => {
    const run = handler([event('boundary', 600), event('above', 601), event('unknown', null)]);
    const filtered = await run(request(), { PROOF_TOKEN: TOKEN });
    expect((await filtered.json() as { events: { id: string }[] }).events.map(event => event.id)).toEqual(['above']);
    const all = await run(request('?significant=false'), { PROOF_TOKEN: TOKEN });
    expect((await all.json() as { events: { id: string }[] }).events.map(event => event.id)).toEqual(['boundary', 'above', 'unknown']);
  });
  it('discovers recent earthquakes without creating an assessment or archive capture', async () => {
    const response = await handler([event('us-test')])(request(), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ events: [{ id: 'us-test', significance: 601, latitude: 35, longitude: -117, aliases: ['us-test'] }], offset: 0, limit: 50, hasMore: false, completeness: 'complete', rejected: 0 });
  });
});


describe('historical catalog HTTP interface', () => {
  it('searches source-supported historical dates without a Catlas starting year or significance gate', async () => {
    const old = event('historical', 100); old.properties.time = Date.parse('1850-02-01T12:00:00.000Z');
    const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const valid = url.origin === 'https://earthquake.usgs.gov' && url.searchParams.get('starttime') === '1800-01-01T00:00:00.000Z' && url.searchParams.get('endtime') === '1900-01-01T00:00:00.000Z' && !url.searchParams.has('minsig') && url.searchParams.get('limit') === '51';
      return valid ? Response.json({type:'FeatureCollection',features:[old]}) : new Response(null,{status:400});
    } } as unknown as ArchiveDependencies;
    const response = await createArchiveHandler(deps)(request('?mode=historical&start=1800-01-01T00:00:00.000Z&end=1900-01-01T00:00:00.000Z'), {PROOF_TOKEN:TOKEN});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({events:[{id:'historical',occurredAt:'1850-02-01T12:00:00.000Z'}],range:{start:'1800-01-01T00:00:00.000Z',end:'1900-01-01T00:00:00.000Z'}});
  });
});


it('historical HTTP search forwards only bounded geographic and magnitude fields with stable paging', async () => {
  const deps = { database: {}, bucket: {}, rateLimit: async () => true, providerFetch: async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const expected = {minmagnitude:'4.5',maxmagnitude:'9',minlatitude:'30',maxlatitude:'40',minlongitude:'-125',maxlongitude:'-110',offset:'51',limit:'51'};
    return Object.entries(expected).every(([key,value])=>url.searchParams.get(key)===value) ? Response.json({type:'FeatureCollection',features:[event('filtered')]}) : new Response(null,{status:400});
  } } as unknown as ArchiveDependencies;
  const response = await createArchiveHandler(deps)(request('?mode=historical&start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minMagnitude=4.5&maxMagnitude=9&minLatitude=30&maxLatitude=40&minLongitude=-125&maxLongitude=-110&offset=50'),{PROOF_TOKEN:TOKEN});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({events:[{id:'filtered'}],offset:50,range:{start:'2019-01-01T00:00:00.000Z',end:'2020-01-01T00:00:00.000Z'}});
});


it.each([
  'start=2019-02-30T00:00:00.000Z&end=2020-01-01T00:00:00.000Z',
  'start=2019-01-01&end=2020-01-01',
  'start=2020-01-01T00:00:00.000Z&end=2019-01-01T00:00:00.000Z',
  'start=2019-01-01T00:00:00.000Z',
  'start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minMagnitude=NaN',
  'start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minMagnitude=7&maxMagnitude=4',
  'start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minLatitude=30',
  'start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minLatitude=-91&maxLatitude=40&minLongitude=-125&maxLongitude=-110',
  'start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minLatitude=40&maxLatitude=30&minLongitude=-125&maxLongitude=-110',
  'start=2019-01-01T00:00:00.000Z&end=2020-01-01T00:00:00.000Z&minLatitude=30&maxLatitude=40&minLongitude=-200&maxLongitude=200',
])('refuses invalid historical dates and filters before source acquisition: %s', async fields => {
  const deps = { database:{}, bucket:{}, rateLimit:async()=>true, providerFetch:async()=>{throw Error('must not acquire source');} } as unknown as ArchiveDependencies;
  expect((await createArchiveHandler(deps)(request('?mode=historical&'+fields),{PROOF_TOKEN:TOKEN})).status).toBe(400);
});


it('resolves a historical source alias to one canonical event independent of recent significance and date windows', async () => {
  const old = event('canonical',null,2000,',canonical,alias,'); old.properties.time=Date.parse('1906-04-18T13:12:00.000Z');
  const deps={database:{},bucket:{},rateLimit:async()=>true,providerFetch:async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    return url.searchParams.get('eventid')==='alias' && [...url.searchParams.keys()].sort().join(',')==='eventid,format' ? Response.json(old) : new Response(null,{status:400});
  }} as unknown as ArchiveDependencies;
  const response=await createArchiveHandler(deps)(request('?mode=historical&eventId=alias'),{PROOF_TOKEN:TOKEN});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({events:[{id:'canonical',aliases:['canonical','alias'],significance:null}],hasMore:false,completeness:'complete'});
});


it.each(['eventId=bad%20id','eventId=alias&offset=50','eventId=alias&significant=true','eventId=alias&start=2019-01-01T00:00:00.000Z','eventId=alias&minMagnitude=5','eventId='])('refuses invalid or conflicting source ID query: %s',async fields=>{
  expect((await handler([])(request('?mode=historical&'+fields),{PROOF_TOKEN:TOKEN})).status).toBe(400);
});


it('distinguishes a missing historical source ID from provider failure',async()=>{
  const deps={database:{},bucket:{},rateLimit:async()=>true,providerFetch:async()=>new Response(null,{status:404})} as unknown as ArchiveDependencies;
  const run=createArchiveHandler(deps);
  const missing=await run(request('?mode=historical&eventId=missing'),{PROOF_TOKEN:TOKEN});
  expect(missing.status).toBe(200);
  expect(await missing.json()).toMatchObject({events:[],completeness:'complete'});
  deps.providerFetch=async()=>new Response(null,{status:503});
  expect((await run(request('?mode=historical&eventId=missing'),{PROOF_TOKEN:TOKEN})).status).toBe(502);
});
