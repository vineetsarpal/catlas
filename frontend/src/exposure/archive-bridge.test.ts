import { describe, expect, it } from 'vitest';
import { archiveBridge } from '../../../functions/_archive';
const env = { ARCHIVE_API_ORIGIN: 'https://capture.example.workers.dev', ARCHIVE_PROOF_TOKEN: 'server-only-proof-token-32-characters' };
describe('same-origin public archive HTTP bridge', () => {
  it('forwards an explicit source check with only a bounded public identity', async () => {
    const post = (body: unknown) => new Request('https://catlas.test/api/exposure/captures/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const checked = await archiveBridge(post({ eventId: 'event-one' }), env, async (url, options) => {
      expect(String(url)).toBe('https://capture.example.workers.dev/api/captures/check');
      expect(JSON.parse(String(options?.body))).toEqual({ eventId: 'event-one' });
      return Response.json({ cache: 'hit' });
    });
    expect(checked.status).toBe(200);
    expect((await archiveBridge(post({ eventId: 'event-one', portfolio: ['private'] }), env)).status).toBe(400);
  });

  it.each(['cleanup_conflict', 'artifact_expired', 'grid_unavailable', 'unsupported_layout', 'unsupported_units', 'database_unavailable', 'object_store_unavailable', 'service_unavailable'])('retains the safe availability outcome %s while stripping private provider diagnostics', async code => {
    const request = new Request('https://catlas.test/api/exposure/captures', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: 'ci38457511' }) });
    const status = code === 'cleanup_conflict' ? 409 : code === 'artifact_expired' ? 410 : code.includes('unavailable') && !['grid_unavailable'].includes(code) ? 503 : 422;
    const response = await archiveBridge(request, env, async () => Response.json({ error: { code, message: `${env.ARCHIVE_PROOF_TOKEN} private database hostname and query` } }, { status }));
    expect(response.status).toBe(status);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain('private');
    expect(body.error.message).not.toContain(env.ARCHIVE_PROOF_TOKEN);
  });
  it('retains only the safe expired-archive context alongside a failed source refetch',async()=>{
    const request=()=>new Request('https://catlas.test/api/exposure/captures',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId:'event-one'})});
    const result=await archiveBridge(request(),env,async()=>Response.json({error:{code:'source_unavailable',message:'PRIVATE diagnostic'},archiveEvidence:'expired'},{status:503}));
    expect(result.status).toBe(503);expect(await result.json()).toMatchObject({error:{code:'source_unavailable'},archiveEvidence:'expired'});
    const unsafe=await archiveBridge(request(),env,async()=>Response.json({error:{code:'source_unavailable'},archiveEvidence:'PRIVATE diagnostic'},{status:503}));
    expect(await unsafe.text()).not.toContain('PRIVATE');
  });

  it('forwards historical public search fields without adding a recent cutoff or revealing credentials', async () => {
    const query = new URLSearchParams({ mode: 'historical', start: '1890-01-01T00:00:00.000Z', end: '1899-12-31T23:59:59.999Z', minMagnitude: '6', maxMagnitude: '9', minLatitude: '-20', maxLatitude: '60', minLongitude: '170', maxLongitude: '200', offset: '50', significant: 'false' });
    const response = await archiveBridge(new Request(`https://catlas.test/api/exposure/catalog?${query}`), env, async (input, init) => {
      expect(new URL(String(input)).searchParams).toEqual(query);
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${env.ARCHIVE_PROOF_TOKEN}`);
      return Response.json({ events: [] });
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(env.ARCHIVE_PROOF_TOKEN);
  });
  it('preserves the server-issued discovery window while paging', async () => {
    const query = '?significant=true&offset=50&end=2026-10-25T12%3A00%3A00.000Z';
    const response = await archiveBridge(new Request(`https://catlas.test/api/exposure/catalog${query}`), env, async input => {
      expect(new URL(String(input)).searchParams.get('end')).toBe('2026-10-25T12:00:00.000Z');
      return Response.json({ events: [] });
    });
    expect(response.status).toBe(200);
  });

  it('accepts exact source-ID discovery without date or significance restrictions', async () => {
    const response = await archiveBridge(new Request('https://catlas.test/api/exposure/catalog?mode=historical&eventId=ci38457511'), env, async input => {
      expect(new URL(String(input)).searchParams.get('eventId')).toBe('ci38457511');
      return Response.json({ events: [] });
    });
    expect(response.status).toBe(200);
  });

  it.each(['0x10', '1e2', ' 6 '])('refuses non-decimal magnitude spellings consistently with the archive: %s', async minMagnitude => {
    const fields = new URLSearchParams({ mode: 'historical', start: '1800-01-01T00:00:00.000Z', end: '1801-01-01T00:00:00.000Z', minMagnitude });
    const response = await archiveBridge(new Request(`https://catlas.test/api/exposure/catalog?${fields}`), env, async () => Response.json({ events: [] }));
    expect(response.status).toBe(400);
  });

  it('accepts valid UTC seconds-only historical dates consistently with the archive', async () => {
    const fields = new URLSearchParams({ mode: 'historical', start: '1800-01-01T00:00:00Z', end: '1801-01-01T00:00:00Z' });
    const response = await archiveBridge(new Request(`https://catlas.test/api/exposure/catalog?${fields}`), env, async () => Response.json({ events: [] }));
    expect(response.status).toBe(200);
  });

  it.each([
    'mode=other', 'start=1890-01-01T00:00:00.000Z',
    'mode=historical&start=1900-02-30T00:00:00.000Z&end=1901-01-01T00:00:00.000Z',
    'mode=historical&start=1901-01-01T00:00:00.000Z&end=1900-01-01T00:00:00.000Z',
    'mode=historical&eventId=ci38457511&start=1900-01-01T00:00:00.000Z',
    'mode=historical&eventId=ci38457511&minMagnitude=4',
    'mode=historical&eventId=https://outside.test',
    'mode=historical&eventId=ci38457511&eventId=other',
    'mode=historical&start=1900-01-01T00:00:00.000Z&end=1901-01-01T00:00:00.000Z&minMagnitude=Infinity',
    'mode=historical&start=1900-01-01T00:00:00.000Z&end=1901-01-01T00:00:00.000Z&minLatitude=-91',
    'mode=historical&start=1900-01-01T00:00:00.000Z&end=1901-01-01T00:00:00.000Z&minLongitude=-361',
    'mode=historical&eventId=ci38457511&insuredLocations=private',
  ])('refuses invalid historical queries before forwarding: %s', async query => {
    const response = await archiveBridge(new Request(`https://catlas.test/api/exposure/catalog?${query}`), env, async () => Response.json({ leaked: true }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('leaked');
  });

  it('keeps provider refusal codes but strips diagnostics and refuses redirects', async () => {
    const req = () => new Request('https://catlas.test/api/exposure/catalog');
    const quota = await archiveBridge(req(), env, async () => Response.json({ error: { code: 'provider_quota', message: env.ARCHIVE_PROOF_TOKEN } }, { status: 503 }));
    const body = await quota.text();
    expect(JSON.parse(body).error.code).toBe('provider_quota');
    expect(body).not.toContain(env.ARCHIVE_PROOF_TOKEN);
    const redirected = await archiveBridge(req(), env, async () => new Response('private redirect response', { status: 302, headers: { location: 'https://outside.test' } }));
    expect(redirected.status).toBe(503);
    expect(redirected.headers.get('location')).toBeNull();
    const offline = await archiveBridge(req(), env, async () => { throw new Error(env.ARCHIVE_PROOF_TOKEN); });
    expect(offline.status).toBe(503);
    expect(await offline.text()).not.toContain(env.ARCHIVE_PROOF_TOKEN);
  });

  it.each([undefined, 'http://capture.example.workers.dev', 'https://user:secret@capture.example.workers.dev', 'https://capture.example.workers.dev/path', 'https://outside.example'])('fails closed for missing or unsupported server configuration: %s', async origin => {
    const response = await archiveBridge(new Request('https://catlas.test/api/exposure/catalog'), { ...env, ARCHIVE_API_ORIGIN: origin }, async () => Response.json({ leaked: true }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });

  it('forwards only a bounded public event ID and refuses insured-data payloads', async () => {
    const post = (body: unknown) => new Request('https://catlas.test/api/exposure/captures', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const invalid = await archiveBridge(post({ eventId: 'event-one', portfolio: ['private'] }), env, async () => Response.json({ accepted: true }));
    expect(invalid.status).toBe(400);
    const accepted = await archiveBridge(post({ eventId: 'event-one' }), env, async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ eventId: 'event-one' });
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      return Response.json({ accepted: true }, { status: 201 });
    });
    expect(accepted.status).toBe(201);
    expect((await archiveBridge(post({ eventId: 'x'.repeat(300) }), env)).status).toBe(413);
  });

  it.each(['/api/exposure/maintenance/usage', '/api/exposure/catalog?url=https://outside.test', '/api/exposure/catalog?offset=9999', '/api/exposure/catalog?offset=500', '/api/exposure/catalog?offset=1', '/api/exposure/catalog?significant=yes', '/api/exposure/catalog?offset=0&offset=50', '/api/exposure/captures/event-one?portfolio=private'])('refuses unsupported public routes or fields: %s', async path => {
    const response = await archiveBridge(new Request(`https://catlas.test${path}`), env, async () => Response.json({ leaked: true }));
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toContain('leaked');
  });

  it.each(['cleanup/preview','cleanup/confirm','retention','backups/start','backups/advance','backups/restore/start','backups/restore/advance','backups/rotate'])('keeps private maintenance POST %s outside the browser bridge',async path=>{
    let forwarded=false;
    const response=await archiveBridge(new Request(`https://catlas.test/api/exposure/maintenance/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env,async()=>{forwarded=true;return Response.json({leaked:true});});
    expect(response.status).toBe(404);expect(forwarded).toBe(false);
  });

  it('keeps the private backup inventory outside the browser bridge',async()=>{
    let forwarded=false;
    const response=await archiveBridge(new Request('https://catlas.test/api/exposure/maintenance/backups/inventory'),env,async()=>{forwarded=true;return Response.json({leaked:true});});
    expect(response.status).toBe(404);expect(forwarded).toBe(false);
  });

  it('serves discovery through the fixed archive without exposing its credential', async () => {
    const response = await archiveBridge(new Request('https://catlas.test/api/exposure/catalog?significant=true&offset=0'), env, async (input, init) => {
      expect(String(input)).toBe('https://capture.example.workers.dev/api/catalog?significant=true&offset=0');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${env.ARCHIVE_PROOF_TOKEN}`);
      return Response.json({ events: [], checkedAt: '2026-10-25T00:00:00Z' }, { headers: { 'set-cookie': 'private=value', authorization: 'private' } });
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [], checkedAt: '2026-10-25T00:00:00Z' });
    expect(response.headers.get('authorization')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
