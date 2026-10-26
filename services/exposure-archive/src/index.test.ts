import { describe, expect, it, vi } from 'vitest';
import worker, { createArchiveHandler } from './archive';
import { ArchiveError, type ArchiveDatabase, type Capture } from './types';
import { createCoordinatorHandler } from './coordinator';
import { routeRequest } from './router';
import { createPostgresDatabase } from './neon';

const GRID = '<shakemap_grid><grid_field index="3" name="MMI" units="intensity"/><grid_data>-117 35 6.2</grid_data></shakemap_grid>';
function fixture(gridMetadata: { sha256?: string; length?: number } = {}) {
  const captures = new Map<string, Capture>(); const objects = new Map<string, { bytes: ArrayBuffer; hash: ArrayBuffer }>(); let leased = false;
  const database: ArchiveDatabase = {
    async lookup(id) { return captures.get(id) ?? null; },
    async status() { return null; },
    async usage() { return { databaseBytes: 8000, reservedArtifactBytes: 0, referencedArtifactBytes: 0, abandonedArtifactBytes: 0, recordedBackupBytes: 0, captureAttemptsToday: 0, maintenanceRequestsToday: 0, usageDate: '2026-10-25' }; },
    async associate(_owner, id, canonical) { const capture = captures.get(canonical); if (capture) captures.set(id, capture); },
    async setBackupUsage() {},
    async acquireMaintenance() { if (leased) return false; leased = true; return true; },
    async orphanCandidates() { return []; }, async recordOrphan() {},
    async acquire() { if (leased) return false; leased = true; return true; }, async release() { leased = false; },
    async reserve() {}, async publish(_owner, capture) { for (const id of [capture.event.id, ...capture.event.aliases]) captures.set(id, capture); },
    async referencedArtifact(hash) { for (const c of captures.values()) for (const a of Object.values(c.artifacts)) if (a.sha256 === hash) return a; return null; },
  };
  const detail = JSON.stringify({ id: 'ci38457511', properties: { place: 'Ridgecrest', time: 1562383193000, updated: 1562383293000, ids: ',ci38457511,alias1,', products: { shakemap: [{ id: 'urn:usgs-product:ci:shakemap:ci38457511:1', source: 'ci', code: 'ci38457511', updateTime: 1562383293000, status: 'UPDATE', contents: { 'download/grid.xml': { url: 'https://earthquake.usgs.gov/product/shakemap/ci38457511/ci/1/download/grid.xml', ...gridMetadata } } }] } } });
  const bucket = {
    async head(key: string) { const o = objects.get(key); return o ? { size: o.bytes.byteLength, checksums: { sha256: o.hash } } : null; },
    async put(key: string, value: ArrayBuffer | ReadableStream<Uint8Array>, options: { sha256: string }) { const bytes = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer(); const digest = await crypto.subtle.digest('SHA-256', bytes); const actual = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join(''); if (actual !== options.sha256) throw new Error('R2 checksum mismatch'); objects.set(key, { bytes, hash: digest }); },
    async get(key: string) { const o = objects.get(key); return o ? { size: o.bytes.byteLength, checksums: { sha256: o.hash }, body: new Response(o.bytes).body! } : null; },
  };
  const providerFetch: typeof fetch = async (input) => new Response(String(input).includes('grid.xml') ? GRID : detail);
  return { database, bucket, providerFetch, rateLimit: async () => true };
}
class EdgeFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expected: number) { let bytes = 0; super({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > expected) throw new Error('FixedLengthStream length exceeded'); controller.enqueue(chunk); }, flush() { if (bytes !== expected) throw new Error('FixedLengthStream length mismatch'); } }); }
}
vi.stubGlobal('FixedLengthStream', EdgeFixedLengthStream);
const TOKEN = 'test-token-at-least-24-characters';
const authorized = (path: string, body?: unknown) => new Request(`https://proof.example${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('public archive HTTP boundary', () => {
  it('keeps an event with no active ShakeMap distinct from missing grid and pending capture states', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (...args) => {
      const detail = await (await upstream(...args)).json() as { properties: { products: { shakemap: unknown[] } } };
      detail.properties.products.shakemap = [];
      return Response.json(detail);
    };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('evidence_unavailable');
    deps.database.status = async () => 'pending';
    const pending = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(pending.status).toBe(409);
    expect((await pending.json() as { error: { code: string } }).error.code).toBe('capture_pending');
  });

  it.each([false, true])('distinguishes source grid-body interruption from API failure (streamed=%s) and explicitly retries', async streamed => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(GRID));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const deps = fixture(streamed ? { sha256, length: new TextEncoder().encode(GRID).length } : {});
    const upstream = deps.providerFetch; let unavailable = true;
    deps.providerFetch = async (...args) => String(args[0]).includes('grid.xml') && unavailable
      ? new Response(new ReadableStream({ start(controller) { controller.error(new Error('private source body transport details')); } }))
      : upstream(...args);
    const handler = createArchiveHandler(deps);
    const failed = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(502);
    expect((await failed.json() as { error: { code: string } }).error.code).toBe('source_unavailable');
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
    unavailable = false;
    expect((await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).status).toBe(201);
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(200);
  });

  it('recovers a generic API interruption without losing the frozen capture', async () => {
    const deps = fixture(); const handler = createArchiveHandler(deps);
    const first = await (await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).json() as Capture;
    let unavailable = true;
    deps.rateLimit = async () => { if (unavailable) throw new Error('private API dependency diagnostics'); return true; };
    const failed = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: { code: 'service_unavailable', message: 'The archive service failed. Previously saved local cases remain usable.' } });
    unavailable = false;
    const recovered = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ event: first.event, product: first.product, capturedAt: first.capturedAt, artifacts: first.artifacts });
  });

  it('retains a successful capture through source failure and resolves a new alias on explicit retry', async () => {
    const deps = fixture(); const handler = createArchiveHandler(deps);
    const first = await (await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).json() as Capture;
    const upstream = deps.providerFetch; let unavailable = true;
    deps.providerFetch = async (...args) => unavailable ? new Response('private source detail', { status: 503 }) : upstream(...args);
    const failed = await handler(authorized('/api/captures', { eventId: 'later-source-alias' }), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(502);
    expect((await failed.json() as { error: { code: string } }).error.code).toBe('source_unavailable');
    expect(await (await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).json()).toMatchObject({ capturedAt: first.capturedAt, artifacts: first.artifacts });
    unavailable = false;
    const recovered = await handler(authorized('/api/captures', { eventId: 'later-source-alias' }), { PROOF_TOKEN: TOKEN });
    expect(recovered.status).toBe(200);
    expect(await (await handler(authorized('/api/captures/later-source-alias'), { PROOF_TOKEN: TOKEN })).json()).toMatchObject({ event: first.event, product: first.product, capturedAt: first.capturedAt, artifacts: first.artifacts });
  });

  it('recovers object-store access without changing retained capture identities or original bytes', async () => {
    const deps = fixture(); const handler = createArchiveHandler(deps);
    const first = await (await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).json() as Capture;
    const read = deps.bucket.head; let unavailable = true;
    deps.bucket.head = async key => { if (unavailable) throw new Error('private R2 storage diagnostic'); return read(key); };
    const failed = await handler(authorized('/api/captures/alias1'), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: { code: 'object_store_unavailable', message: 'The public evidence object store is unavailable. Retry explicitly.' } });
    unavailable = false;
    const recovered = await handler(authorized('/api/captures/alias1'), { PROOF_TOKEN: TOKEN });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ event: first.event, product: first.product, capturedAt: first.capturedAt, artifacts: first.artifacts });
    expect(await (await handler(authorized(first.artifacts.grid.path), { PROOF_TOKEN: TOKEN })).text()).toBe(GRID);
  });

  it('recovers a Neon transport interruption and retrieves the retained capture through its alias', async () => {
    const deps = fixture(); const handler = createArchiveHandler(deps);
    const first = await (await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).json() as Capture;
    let unavailable = true;
    deps.database = createPostgresDatabase(async () => {
      if (unavailable) throw new Error('private Neon connection details postgres://secret:password@database.invalid');
      return [{ manifest: first }];
    });
    const failed = await handler(authorized('/api/captures/alias1'), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: { code: 'database_unavailable', message: 'The public metadata database is unavailable. Retry explicitly.' } });
    unavailable = false;
    const recovered = await handler(authorized('/api/captures/alias1'), { PROOF_TOKEN: TOKEN });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ event: first.event, product: first.product, capturedAt: first.capturedAt, artifacts: first.artifacts });
  });

  it('reports a selected grid that is no longer available without replacing it', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (...args) => String(args[0]).includes('grid.xml') ? new Response('private missing grid diagnostics', { status: 404 }) : upstream(...args);
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('grid_unavailable');
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });

  it('distinguishes a grid missing its MMI field from incompatible units', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (...args) => new Response((await (await upstream(...args)).text()).replace('name="MMI"', 'name="PGA"'));
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('unsupported_layout');
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });

  it('distinguishes an active ShakeMap without a numeric grid from no active product', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (...args) => {
      const detail = await (await upstream(...args)).json() as { properties: { products: { shakemap: Array<{ contents: unknown }> } } };
      detail.properties.products.shakemap[0].contents = {};
      return Response.json(detail);
    };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: 'grid_unavailable', message: 'The selected active ShakeMap has no numeric grid.xml. Intensity is unknown.' } });
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });

  it('preserves provider quota classification when publication cannot be confirmed', async () => {
    const deps = fixture(); deps.database.publish = async () => { throw new ArchiveError('provider_quota', 'Neon is limiting requests.', 503); };
    const response = await createArchiveHandler(deps)(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(503);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('provider_quota');
    expect(body.error.message).toContain('Publication could not be confirmed');
  });

  it.each([
    ['Neon disabled endpoint', 'Neon', 'The endpoint is disabled. private diagnostics', 'provider_suspended'],
    ['Neon cold start', 'Neon', 'Server error (HTTP status 503): cold start', 'database_unavailable'],
    ['R2 entitlement', 'R2', 'R2 HEAD: private diagnostic (10042)', 'provider_suspended'],
    ['R2 permissions', 'R2', 'R2 HEAD: Forbidden (10003)', 'object_store_unavailable'],
  ])('classifies %s narrowly without exposing provider diagnostics', async (_name, provider, diagnostic, expected) => {
    const deps = fixture();
    if (provider === 'Neon') deps.database = createPostgresDatabase(async () => { throw new Error(diagnostic); });
    else deps.bucket.head = async () => { throw new Error(diagnostic); };
    const response = await createArchiveHandler(deps)(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    const body = await response.text();
    expect(JSON.parse(body).error.code).toBe(expected);
    expect(body).not.toContain(diagnostic);
  });

  it('distinguishes an upstream source quota from unavailable earthquake evidence', async () => {
    const deps = fixture(); deps.providerFetch = async () => new Response('private source quota details', { status: 429 });
    const response = await createArchiveHandler(deps)(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'provider_quota', message: 'USGS is limiting source requests. Retry explicitly later.' } });
  });

  it('reports a Neon provider quota without exposing the database response', async () => {
    const deps = fixture(); deps.database = createPostgresDatabase(async () => { throw new Error('Server error (HTTP status 429): private database diagnostics'); });
    const response = await createArchiveHandler(deps)(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'provider_quota', message: 'Neon is limiting requests or has exhausted a provider allowance. Retry explicitly later.' } });
  });

  it('preserves a provider-quota refusal when an upload is interrupted', async () => {
    const deps = fixture(); deps.bucket.put = async () => { throw new Error('R2 PUT: private diagnostic (10058)'); };
    const response = await createArchiveHandler(deps)(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect((await response.json() as { error: { code: string } }).error.code).toBe('provider_quota');
  });

  it('distinguishes object-provider throttling from application storage refusal', async () => {
    const deps = fixture(); deps.bucket.head = async () => { throw new Error('R2 HEAD: private diagnostic (10058)'); };
    const response = await createArchiveHandler(deps)(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'provider_quota', message: 'R2 is limiting requests or has exhausted a provider allowance. Retry explicitly later.' } });
  });

  it('reports private storage accounting including backups and abandoned reservations', async () => {
    const deps = fixture();
    Object.assign(deps.database, { usage: async () => ({ databaseBytes: 8000, reservedArtifactBytes: 1200, referencedArtifactBytes: 1000, abandonedArtifactBytes: 200, recordedBackupBytes: 1500, captureAttemptsToday: 2, usageDate: '2026-10-25' }) });
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/maintenance/usage'), { PROOF_TOKEN: TOKEN, MAX_R2_BYTES: '10000', BACKUP_RESERVED_BYTES: '1000' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reservedArtifactBytes: 1200, abandonedArtifactBytes: 200, recordedBackupBytes: 1500, effectiveBackupBytes: 1500, accountedObjectBytes: 2700, availableObjectBytes: 7300 });
  });

  it('makes a newly discovered source alias retrievable without rewriting the retained capture', async () => {
    const handler = createArchiveHandler(fixture());
    const first = await (await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).json() as Capture;
    expect((await handler(authorized('/api/captures', { eventId: 'later-alias' }), { PROOF_TOKEN: TOKEN })).status).toBe(200);
    const retrieved = await handler(authorized('/api/captures/later-alias'), { PROOF_TOKEN: TOKEN });
    expect(retrieved.status).toBe(200);
    expect((await retrieved.json() as Capture).capturedAt).toBe(first.capturedAt);
  });

  it('reconciles a bounded batch of abandoned evidence without exposing it as a capture', async () => {
    const deps = fixture();
    const abandoned = Array.from({ length: 20 }, (_, index) => ({ sha256: index.toString(16).padStart(64, '0'), bytes: 100 }));
    Object.assign(deps.database, {
      orphanCandidates: async (_owner: string, limit: number) => abandoned.slice(0, limit),
      recordOrphan: async () => {},
    });
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/maintenance/reconcile', {}), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checked: 16, present: 0, missing: 16, invalid: 0, retainedBytes: 1600 });
    expect((await handler(authorized('/api/artifacts/' + abandoned[0].sha256), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });

  it('bounds a stalled object-store check and permits a later explicit retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deps = fixture(); const head = deps.bucket.head;
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
    deps.bucket.head = async () => { entered(); await blocked; return null; };
    const handler = createArchiveHandler(deps);
    let settled: Response | undefined;
    const pending = handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN }).then(response => { settled = response; return response; });
    try {
      await started; await vi.advanceTimersByTimeAsync(15_000);
      expect(settled?.status).toBe(503);
    } finally { unblock(); await pending; vi.useRealTimers(); }
    deps.bucket.head = head;
    expect((await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).status).toBe(201);
  });

  it('recovers the immutable capture when publication commits but its acknowledgement is lost', async () => {
    const deps = fixture(); const publish = deps.database.publish;
    deps.database.publish = async (...args) => { await publish(...args); throw new Error('acknowledgement lost'); };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(200);
    const capture = await response.json() as Capture;
    const retried = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect((await retried.json() as Capture).artifacts).toEqual(capture.artifacts);
  });

  it('returns a completed capture even if lease cleanup loses its acknowledgement', async () => {
    const deps = fixture(); deps.database.release = async () => { throw new Error('connection lost'); };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(201);
    const capture = await response.json() as Capture;
    expect((await (await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).json() as Capture).capturedAt).toBe(capture.capturedAt);
  });

  it('reports a pending capture while another request acquires evidence', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let pending = false;
    Object.assign(deps.database, { status: async () => pending ? 'pending' : null });
    deps.providerFetch = async (...args) => { pending = true; entered(); await blocked; return upstream(...args); };
    const handler = createArchiveHandler(deps);
    const capture = handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    await started;
    try {
      const response = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
      expect(response.status).toBe(409);
      expect((await response.json() as { error: { code: string } }).error.code).toBe('capture_pending');
    } finally { release(); await capture; }
  });

  it('requires authentication before accepting capture requests', async () => {
    const response = await worker.fetch(new Request('https://proof.example/api/captures', { method: 'POST', body: '{"eventId":"ci38457511"}' }), {} as never);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: 'A valid proof token is required.' } });
  });
  it('rejects insured-data fields rather than accepting an open-ended capture payload', async () => {
    const response = await worker.fetch(new Request('https://proof.example/api/captures', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{"eventId":"ci38457511","portfolio":[{"value":100}]}' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_request', message: 'Send only a valid USGS eventId.' } });
  });
  it('captures public evidence, retrieves exact bytes, then reuses the same capture', async () => {
    const handler = createArchiveHandler(fixture());
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(201);
    const first = await response.json() as Capture & { cache: string };
    expect(first.cache).toBe('miss');
    expect(first.artifacts.grid.sha256).toBe('48c9888fc2f87da3f92fab08e3f189eb778b23bb11b928bf8692888bc1ece6aa');
    const original = await handler(authorized(first.artifacts.grid.path), { PROOF_TOKEN: TOKEN });
    expect(await original.text()).toBe(GRID);
    const repeated = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    const second = await repeated.json() as Capture & { cache: string };
    expect(second.cache).toBe('hit');
    expect(second.capturedAt).toBe(first.capturedAt);
    expect(second.artifacts).toEqual(first.artifacts);
    const alias = await handler(authorized('/api/captures/alias1'), { PROOF_TOKEN: TOKEN });
    expect((await alias.json() as Capture).event.id).toBe('ci38457511');
  });
  it('keeps unsupported MMI units unassessable and does not publish a capture', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (...args) => { const response = await upstream(...args); return new Response((await response.text()).replace('units="intensity"', 'units="cm/s"')); };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('unsupported_units');
    const cached = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(cached.status).toBe(404);
  });
  it('does not advertise an interrupted object write and succeeds on explicit retry', async () => {
    const deps = fixture(); const write = deps.bucket.put; let fail = true;
    deps.bucket.put = async (...args) => { if (fail) throw new Error('private upstream diagnostics'); return write(...args); };
    const handler = createArchiveHandler(deps);
    const failed = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: { code: 'object_store_unavailable', message: 'The public evidence object store is unavailable. Retry explicitly.' } });
    const missing = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(missing.status).toBe(404);
    fail = false;
    const retried = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(retried.status).toBe(201);
    expect((await retried.json() as Capture).event.id).toBe('ci38457511');
  });
  it('refuses acquisition at the rate limit without creating a capture', async () => {
    const deps = fixture(); deps.rateLimit = async () => false;
    const handler = createArchiveHandler(deps);
    const limited = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(limited.status).toBe(429);
    expect((await limited.json() as { error: { code: string } }).error.code).toBe('rate_limited');
  });
  it('refuses evidence above the configured byte limit and leaves no capture available', async () => {
    const handler = createArchiveHandler(fixture());
    const failed = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN, MAX_GRID_BYTES: '10' });
    expect(failed.status).toBe(413);
    const cached = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(cached.status).toBe(404);
  });
  it('preserves existing reads when the storage budget refuses a new capture', async () => {
    const deps = fixture(); const handler = createArchiveHandler(deps);
    const first = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(first.status).toBe(201);
    deps.database.acquire = async () => { throw new ArchiveError('capacity_exceeded', 'The proof storage budget was reached.', 507); };
    const failed = await handler(authorized('/api/captures', { eventId: 'different-event' }), { PROOF_TOKEN: TOKEN });
    expect(failed.status).toBe(507);
    const retained = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(retained.status).toBe(200);
    const metadata = await retained.json() as Capture;
    const original = await handler(authorized(metadata.artifacts.grid.path), { PROOF_TOKEN: TOKEN });
    expect(await original.text()).toBe(GRID);
  });
  it('does not advertise missing artifacts when a newly requested source ID resolves to a captured event', async () => {
    const deps = fixture(); const handler = createArchiveHandler(deps);
    expect((await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN })).status).toBe(201);
    deps.bucket.head = async () => null;
    const response = await handler(authorized('/api/captures', { eventId: 'new-source-alias' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('artifact_unavailable');
  });
  it('reports a source HTTP 403 without exposing the upstream response body or publishing evidence', async () => {
    const deps = fixture(); deps.providerFetch = async () => new Response('private source diagnostics that must not be exposed', { status: 403 });
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'source_unavailable', message: 'USGS GET event detail returned HTTP 403. Retry explicitly.' } });
    const cached = await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN });
    expect(cached.status).toBe(404);
  });
  it('distinguishes a source transport error without exposing diagnostic text', async () => {
    const deps = fixture(); deps.providerFetch = async () => { throw new TypeError('fetch failed: network connection lost; Bearer secret-never-expose'); };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: { code: 'source_unavailable', message: 'USGS GET event detail transport failed. Retry explicitly.' } });
    expect(body).not.toContain('network connection lost');
    expect(body).not.toContain('secret-never-expose');
  });
  it('captures through the edge fetch interface that supports manual but not error redirects', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (input, init) => {
      if (init?.redirect === 'error') throw new TypeError('Invalid redirect value: edge fetch supports follow or manual.');
      return upstream(input, init);
    };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(201);
    const capture = await response.json() as Capture;
    expect(await (await handler(authorized(capture.artifacts.grid.path), { PROOF_TOKEN: TOKEN })).text()).toBe(GRID);
  });
  it('refuses a source redirect without following its target or publishing a capture', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    deps.providerFetch = async (input, init) => {
      if (String(input).includes('grid.xml')) {
        // Model the external fetch redirect behavior: a followed redirect supplies
        // otherwise-valid evidence, but a manual request returns only the redirect.
        return init?.redirect === 'manual' ? new Response(null, { status: 302, headers: { location: 'https://outside-source.example/grid.xml' } }) : upstream(input, init);
      }
      return upstream(input, init);
    };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'source_redirect', message: 'USGS GET numeric grid returned HTTP 302. Redirects are not followed.' } });
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });
  it('captures an original grid through the native object-store stream when the source supplies hash and length', async () => {
    const deps = fixture({ sha256: 'SMmIj8L4faP5L6sI4/GJ63eLI7sRuSi/hpKIi8Hs5qo=', length: new TextEncoder().encode(GRID).byteLength });
    const write = deps.bucket.put;
    deps.bucket.put = async (key, value, options) => {
      if (key === 'sha256/48c9888fc2f87da3f92fab08e3f189eb778b23bb11b928bf8692888bc1ece6aa' && value instanceof ArrayBuffer) throw new Error('This external object-store boundary accepts grid streams only.');
      return write(key, value, options);
    };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(201);
    const capture = await response.json() as Capture;
    expect(await (await handler(authorized(capture.artifacts.grid.path), { PROOF_TOKEN: TOKEN })).text()).toBe(GRID);
  });
  it('never publishes a streamed grid that is shorter than the source-declared byte length', async () => {
    const deps = fixture({ sha256: '48c9888fc2f87da3f92fab08e3f189eb778b23bb11b928bf8692888bc1ece6aa', length: new TextEncoder().encode(GRID).byteLength + 10 });
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(502);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('source_integrity');
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });
  it('never publishes streamed bytes rejected by native object-store checksum verification', async () => {
    const deps = fixture({ sha256: '48c9888fc2f87da3f92fab08e3f189eb778b23bb11b928bf8692888bc1ece6aa', length: new TextEncoder().encode(GRID).byteLength });
    const upstream = deps.providerFetch;
    deps.providerFetch = async (input, init) => String(input).includes('grid.xml') ? new Response(GRID.replace('6.2', '6.3')) : upstream(input, init);
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('artifact_integrity');
    expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
  });
  it('uploads both original detail and grid through the object-store streaming boundary', async () => {
    const deps = fixture({ sha256: 'SMmIj8L4faP5L6sI4/GJ63eLI7sRuSi/hpKIi8Hs5qo=', length: new TextEncoder().encode(GRID).byteLength });
    const write = deps.bucket.put;
    deps.bucket.put = async (key, value, options) => {
      if (value instanceof ArrayBuffer) throw new Error('This external object store accepts streams only.');
      return write(key, value, options);
    };
    const handler = createArchiveHandler(deps);
    const response = await handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN });
    expect(response.status).toBe(201);
    const capture = await response.json() as Capture;
    const detail = await handler(authorized(capture.artifacts.detail.path), { PROOF_TOKEN: TOKEN });
    expect((await detail.json() as { id: string }).id).toBe('ci38457511');
    expect(await (await handler(authorized(capture.artifacts.grid.path), { PROOF_TOKEN: TOKEN })).text()).toBe(GRID);
  });
  it('times out a hanging source at the acquisition deadline without making a capture available', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deps = fixture();
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let stop!: () => void;
    deps.providerFetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      stop = () => reject(new Error('Disposable test provider stopped'));
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      entered();
    });
    const handler = createArchiveHandler(deps);
    let settled: Response | undefined;
    const pending = handler(authorized('/api/captures', { eventId: 'ci38457511' }), { PROOF_TOKEN: TOKEN }).then(response => { settled = response; return response; });
    try {
      await started;
      await vi.advanceTimersByTimeAsync(59_999);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled?.status).toBe(502);
      expect((await settled!.json() as { error: { code: string } }).error.code).toBe('source_unavailable');
      expect((await handler(authorized('/api/captures/ci38457511'), { PROOF_TOKEN: TOKEN })).status).toBe(404);
    } finally { stop(); await pending; vi.useRealTimers(); }
  });
});

describe('Durable Object proof HTTP route', () => {
  it('forwards captures to the coordinator and exposes authenticated original-byte retrieval', async () => {
    const deps = fixture({ sha256: 'SMmIj8L4faP5L6sI4/GJ63eLI7sRuSi/hpKIi8Hs5qo=', length: new TextEncoder().encode(GRID).byteLength });
    const execute = createCoordinatorHandler((request, env) => createArchiveHandler(deps)(request, env));
    const env = { CAPTURE_COORDINATOR: {
      idFromName: () => 'proof-coordinator',
      get: () => ({ fetch: (request: Request) => execute(request, { PROOF_TOKEN: TOKEN }) }),
    } } as never;
    const response = await routeRequest(authorized('/api/captures', { eventId: 'ci38457511' }), env);
    expect(response.status).toBe(201);
    expect(response.headers.get('X-Catlas-Executor')).toBe('durable-object');
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    const capture = await response.json() as Capture;
    const original = await routeRequest(authorized(capture.artifacts.grid.path), env);
    expect(original.status).toBe(200);
    expect(await original.text()).toBe(GRID);
    const unauthenticated = await routeRequest(new Request(`https://proof.example${capture.artifacts.grid.path}`), env);
    expect(unauthenticated.status).toBe(401);
  });
  it('admits only one capture while allowing authenticated reads and rejecting unauthorized requests', async () => {
    const deps = fixture(); const upstream = deps.providerFetch;
    // The coordinator must bound its own admission even before the external
    // database lease responds or when a test database has no lease implementation.
    deps.database.acquire = async () => true;
    deps.database.release = async () => {};
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const requested = new Promise<void>(resolve => { entered = resolve; }); let held = false;
    deps.providerFetch = async (input, init) => { if (!held) { held = true; entered(); await wait; } return upstream(input, init); };
    const execute = createCoordinatorHandler((request, env, admission) => createArchiveHandler(deps, admission)(request, env));
    const env = { CAPTURE_COORDINATOR: { idFromName: () => 'proof', get: () => ({ fetch: (request: Request) => execute(request, { PROOF_TOKEN: TOKEN }) }) } } as never;
    const first = routeRequest(authorized('/api/captures', { eventId: 'ci38457511' }), env);
    await requested;
    try {
      expect((await routeRequest(new Request('https://proof.example/api/captures', { method: 'POST', body: '{}' }), env)).status).toBe(401);
      expect((await routeRequest(authorized('/api/captures/ci38457511'), env)).status).toBe(404);
      const overlapping = await routeRequest(authorized('/api/captures', { eventId: 'ci38457511' }), env);
      expect(overlapping.status).toBe(409);
      expect((await overlapping.json() as { error: { code: string } }).error.code).toBe('capture_busy');
    } finally { release(); }
    expect((await first).status).toBe(201);
    expect((await routeRequest(authorized('/api/captures/ci38457511'), env)).status).toBe(200);
  });
  it('leaves interrupted captures unavailable through the coordinator and permits an explicit retry', async () => {
    const deps = fixture(); const write = deps.bucket.put; let fail = true;
    deps.bucket.put = async (...args) => { if (fail) throw new Error('Disposable object store unavailable'); return write(...args); };
    const execute = createCoordinatorHandler((request, env, admission) => createArchiveHandler(deps, admission)(request, env));
    const env = { CAPTURE_COORDINATOR: { idFromName: () => 'proof', get: () => ({ fetch: (request: Request) => execute(request, { PROOF_TOKEN: TOKEN }) }) } } as never;
    const failed = await routeRequest(authorized('/api/captures', { eventId: 'ci38457511' }), env);
    expect(failed.status).toBe(503);
    expect(failed.headers.get('X-Catlas-Executor')).toBe('durable-object');
    expect((await routeRequest(authorized('/api/captures/ci38457511'), env)).status).toBe(404);
    fail = false;
    expect((await routeRequest(authorized('/api/captures', { eventId: 'ci38457511' }), env)).status).toBe(201);
  });
  it('serves the static proof page without a coordinator and fails closed if the API coordinator is unavailable', async () => {
    const page = await routeRequest(new Request('https://proof.example/'), { ASSETS: { fetch: async () => new Response('Proof page') } } as never);
    expect(await page.text()).toBe('Proof page');
    const failed = await routeRequest(authorized('/api/captures/ci38457511'), {});
    expect(failed.status).toBe(503);
    expect((await failed.json() as { error: { code: string } }).error.code).toBe('coordinator_unavailable');
  });
});
