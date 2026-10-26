import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createArchiveHandler } from './archive';
import { createPostgresDatabase } from './neon';
import type { ArchiveDependencies, Capture, ObjectBucket } from './types';

// Opt-in disposable PostgreSQL on a fixed local test port. Never reads DATABASE_URL.
const exec = promisify(execFile);
const psql = (sql: string) => exec('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55446', '-U', 'catlas_test', '-d', 'postgres', '-c', sql]);
const literal = (value: unknown) => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
const database = () => createPostgresDatabase(async (text, params) => {
  const bound = text.replace(/\$(\d+)/g, (_match, index: string) => literal(params[Number(index) - 1]));
  const { stdout } = await psql(`SELECT coalesce(json_agg(row_to_json(result)), '[]'::json) FROM (${bound}) result`);
  return JSON.parse(stdout);
});
const TOKEN = 'test-postgres-proof-token-32chars';
const env = { PROOF_TOKEN: TOKEN };
const request = (path: string, body?: unknown) => new Request(`https://proof.test${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
// Runtime adapter for Node; production uses Cloudflare's native FixedLengthStream.
class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expected: number) { let bytes = 0; super({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > expected) throw new Error('Length exceeded'); controller.enqueue(chunk); }, flush() { if (bytes !== expected) throw new Error('Length mismatch'); } }); }
}
vi.stubGlobal('FixedLengthStream', TestFixedLengthStream);
const GRID = '<shakemap_grid><grid_field index="3" name="MMI" units="intensity"/><grid_data>-117 35 6.2</grid_data></shakemap_grid>';
function setup() {
  const objects = new Map<string, ArrayBuffer>();
  let failWrite = 0, writes = 0;
  const bucket: ObjectBucket = {
    async head(key) { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength, checksums: { sha256: await crypto.subtle.digest('SHA-256', bytes) } } : null; },
    async put(key, value) { writes++; if (writes === failWrite) throw new Error('interrupted object write'); objects.set(key, value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer()); },
    async get(key) { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength, checksums: { sha256: await crypto.subtle.digest('SHA-256', bytes) }, body: new Response(bytes).body! } : null; },
  };
  const deps: ArchiveDependencies = { database: database(), bucket, rateLimit: async () => true, providerFetch: async input => {
    if (String(input).includes('grid.xml')) return new Response(GRID);
    const id = new URL(String(input)).searchParams.get('eventid')!;
    return Response.json({ id, properties: { place: id, time: 1000, updated: 2000, ids: `,${id},`, products: { shakemap: [{ id: `product:${id}`, source: 'us', code: id, updateTime: 2000, status: 'UPDATE', contents: { 'download/grid.xml': { url: `https://earthquake.usgs.gov/product/shakemap/${id}/us/1/download/grid.xml` } } }] } } });
  } };
  return { deps, handler: createArchiveHandler(deps), failAt: (number: number) => { failWrite = number; }, writes: () => writes };
}

describe.runIf(process.env.CATLAS_POSTGRES_TEST === '1')('HTTP capture lifecycle with real PostgreSQL', () => {
  beforeAll(async () => {
    await exec('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55446', '-U', 'catlas_test', '-d', 'postgres', '-f', new URL('../schema.sql', import.meta.url).pathname]);
  });
  beforeEach(async () => { await psql("UPDATE catlas_proof_daily_maintenance SET usage_date = (clock_timestamp() AT TIME ZONE 'UTC')::date, requests = 0; UPDATE catlas_proof_backup_usage SET bytes = 0; UPDATE catlas_proof_daily_usage SET usage_date = (clock_timestamp() AT TIME ZONE 'UTC')::date, capture_attempts = 0; TRUNCATE catlas_proof_attempts, catlas_proof_aliases, catlas_proof_captures, catlas_proof_artifact_reconciliation, catlas_proof_artifacts; UPDATE catlas_proof_capture_lease SET owner = NULL, expires_at = '-infinity'"); });

  it('refuses database growth while retaining existing artifact retrieval', async () => {
    const f = setup();
    const capture = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    const full = { ...env, MAX_DATABASE_BYTES: '1' };
    expect((await f.handler(request('/api/captures', { eventId: 'event-two' }), full)).status).toBe(507);
    expect((await f.handler(request('/api/captures/event-one'), full)).status).toBe(200);
    expect(await (await f.handler(request(capture.artifacts.grid.path), full)).text()).toBe(GRID);
  });

  it('bounds private reconciliation operation usage independently of saved reads', async () => {
    const f = setup(); const limited = { ...env, MAX_MAINTENANCE_REQUESTS_PER_DAY: '1' };
    expect((await f.handler(request('/api/maintenance/reconcile', {}), limited)).status).toBe(200);
    const refused = await f.handler(request('/api/maintenance/reconcile', {}), limited);
    expect(refused.status).toBe(429);
    expect((await refused.json() as { error: { code: string } }).error.code).toBe('usage_limit');
    expect((await f.handler(request('/api/maintenance/usage'), limited)).status).toBe(200);
  });

  it('refuses new acquisition at the exact combined storage cap and preserves prior reads', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    const report = await (await f.handler(request('/api/maintenance/usage'), env)).json() as { accountedObjectBytes: number };
    const tight = { ...env, MAX_R2_BYTES: String(report.accountedObjectBytes) };
    f.deps.providerFetch = async () => { throw new Error('This source should never be reached after full-budget refusal.'); };
    const refused = await f.handler(request('/api/captures', { eventId: 'event-two' }), tight);
    expect(refused.status).toBe(507);
    expect((await refused.json() as { error: { code: string } }).error.code).toBe('capacity_exceeded');
    expect((await f.handler(request('/api/captures/event-one'), tight)).status).toBe(200);
    expect(await (await f.handler(request(first.artifacts.grid.path), tight)).text()).toBe(GRID);
    expect(await (await f.handler(request('/api/maintenance/usage'), tight)).json()).toMatchObject({ availableObjectBytes: 0, captureAttemptsToday: 1 });
  });

  it('keeps abandoned reservations charged after reconciliation and permits only verified reuse', async () => {
    const f = setup(); f.failAt(2);
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).status).toBe(503);
    const before = await (await f.handler(request('/api/maintenance/usage'), env)).json() as { reservedArtifactBytes: number; abandonedArtifactBytes: number };
    expect(before.abandonedArtifactBytes).toBeGreaterThan(0);
    expect((await f.handler(request('/api/maintenance/reconcile', {}), env)).status).toBe(200);
    const after = await (await f.handler(request('/api/maintenance/usage'), env)).json();
    expect(after).toMatchObject({ reservedArtifactBytes: before.reservedArtifactBytes, abandonedArtifactBytes: before.abandonedArtifactBytes });
    f.failAt(0);
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).status).toBe(201);
    expect(await (await f.handler(request('/api/maintenance/usage'), env)).json()).toMatchObject({ reservedArtifactBytes: before.reservedArtifactBytes, abandonedArtifactBytes: 0, captureAttemptsToday: 2 });
  });

  it('accounts for declared backups before admitting new captures and refuses unsafe release', async () => {
    const f = setup(); const limitedEnv = { ...env, MAX_R2_BYTES: '2000', BACKUP_RESERVED_BYTES: '1000' };
    const backup = await f.handler(request('/api/maintenance/backup-usage', { bytes: 2000 }), limitedEnv);
    expect(backup.status).toBe(200);
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), limitedEnv)).status).toBe(507);
    const usage = await f.handler(request('/api/maintenance/usage'), limitedEnv);
    expect(await usage.json()).toMatchObject({ effectiveBackupBytes: 2000, accountedObjectBytes: 2000, availableObjectBytes: 0, captureAttemptsToday: 0 });
    expect((await f.handler(request('/api/maintenance/backup-usage', { bytes: 1000 }), limitedEnv)).status).toBe(400);
    expect((await f.handler(request('/api/maintenance/backup-usage', { bytes: 2001 }), limitedEnv)).status).toBe(507);
  });

  it('charges failed acquisitions to the daily limit while preserving saved evidence reads', async () => {
    const f = setup();
    const first = await f.handler(request('/api/captures', { eventId: 'event-one' }), env);
    expect(first.status).toBe(201);
    const upstream = f.deps.providerFetch;
    f.deps.providerFetch = async () => new Response('unavailable', { status: 404 });
    const limitedEnv = { ...env, MAX_CAPTURE_ATTEMPTS_PER_DAY: '2' };
    expect((await f.handler(request('/api/captures', { eventId: 'event-two' }), limitedEnv)).status).toBe(422);
    const refused = await f.handler(request('/api/captures', { eventId: 'event-three' }), limitedEnv);
    expect(refused.status).toBe(429);
    expect((await refused.json() as { error: { code: string } }).error.code).toBe('usage_limit');
    f.deps.providerFetch = upstream;
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), limitedEnv)).status).toBe(200);
    expect((await f.handler(request('/api/captures/event-one'), limitedEnv)).status).toBe(200);
    const usage = await f.handler(request('/api/maintenance/usage'), limitedEnv);
    expect(await usage.json()).toMatchObject({ captureAttemptsToday: 2, maxCaptureAttempts: 2 });
  });

  it('reports pending acquisition to a competing reader and bounds simultaneous capture', async () => {
    const f = setup(), upstream = f.deps.providerFetch;
    let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    f.deps.providerFetch = async (...args) => { entered(); await blocked; return upstream(...args); };
    const first = f.handler(request('/api/captures', { eventId: 'event-one' }), env);
    await started;
    try {
      const pending = await f.handler(request('/api/captures/event-one'), env);
      expect((await pending.json() as { error: { code: string } }).error.code).toBe('capture_pending');
      expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).status).toBe(409);
    } finally { unblock(); }
    expect((await first).status).toBe(201);
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).status).toBe(200);
  });

  it('keeps an interrupted write private, classifies reservations, and reuses verified orphan bytes on retry', async () => {
    const f = setup(); f.failAt(2);
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).status).toBe(503);
    const interrupted = await f.handler(request('/api/captures/event-one'), env);
    expect((await interrupted.json() as { error: { code: string } }).error.code).toBe('capture_interrupted');
    const classified = await f.handler(request('/api/maintenance/reconcile', {}), env);
    expect(await classified.json()).toMatchObject({ checked: 2, present: 1, missing: 1, invalid: 0 });
    f.failAt(0);
    const retried = await f.handler(request('/api/captures', { eventId: 'event-one' }), env);
    expect(retried.status).toBe(201);
    const capture = await retried.json() as Capture;
    expect(await (await f.handler(request(capture.artifacts.grid.path), env)).text()).toBe(GRID);
    expect(f.writes()).toBe(3); // Two attempted writes, then only the missing grid.
    expect(await (await f.handler(request('/api/maintenance/reconcile', {}), env)).json()).toMatchObject({ checked: 0 });
  });

  it('rejects an expired writer and permits a fresh explicit retry without partial publication', async () => {
    const f = setup(); const publish = f.deps.database.publish;
    f.deps.database.publish = async (...args) => {
      // External failure injection: emulate lease expiration while provider/object work was stalled.
      await psql("UPDATE catlas_proof_capture_lease SET expires_at = clock_timestamp() - interval '1 second'");
      return publish(...args);
    };
    const expired = await f.handler(request('/api/captures', { eventId: 'event-one' }), env);
    expect(expired.status).toBe(409);
    const interrupted = await f.handler(request('/api/captures/event-one'), env);
    expect((await interrupted.json() as { error: { code: string } }).error.code).toBe('capture_interrupted');
    f.deps.database.publish = publish;
    expect((await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).status).toBe(201);
    expect(f.writes()).toBe(2); // Retry adopts the already verified original objects.
  });

  it('prevents an expired request cleanup from releasing a newer capture', async () => {
    const f = setup(), upstream = f.deps.providerFetch;
    let releaseFirst!: () => void, releaseSecond!: () => void;
    const firstHold = new Promise<void>(resolve => { releaseFirst = resolve; });
    const secondHold = new Promise<void>(resolve => { releaseSecond = resolve; });
    let enterFirst!: () => void, enterSecond!: () => void;
    const firstStarted = new Promise<void>(resolve => { enterFirst = resolve; });
    const secondStarted = new Promise<void>(resolve => { enterSecond = resolve; });
    f.deps.providerFetch = async (input, init) => {
      const id = new URL(String(input)).searchParams.get('eventid');
      if (id === 'event-one') { enterFirst(); await firstHold; }
      if (id === 'event-two') { enterSecond(); await secondHold; }
      return upstream(input, init);
    };
    const first = f.handler(request('/api/captures', { eventId: 'event-one' }), env);
    await firstStarted;
    await psql("UPDATE catlas_proof_capture_lease SET expires_at = clock_timestamp() - interval '1 second'");
    const second = f.handler(request('/api/captures', { eventId: 'event-two' }), env);
    await secondStarted;
    try {
      releaseFirst(); expect((await first).status).toBe(409);
      expect((await f.handler(request('/api/captures', { eventId: 'event-three' }), env)).status).toBe(409);
      const pending = await f.handler(request('/api/captures/event-two'), env);
      expect((await pending.json() as { error: { code: string } }).error.code).toBe('capture_pending');
    } finally { releaseFirst(); releaseSecond(); await first; }
    expect((await second).status).toBe(201);
  });

  it('retrieves a later source alias using the immutable retained capture', async () => {
    const f = setup(), upstream = f.deps.providerFetch;
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    f.deps.providerFetch = async (input, init) => upstream(String(input).replace('eventid=later-alias', 'eventid=event-one'), init);
    expect((await f.handler(request('/api/captures', { eventId: 'later-alias' }), env)).status).toBe(200);
    const saved = await f.handler(request('/api/captures/later-alias'), env);
    expect(saved.status).toBe(200);
    const alias = await saved.json() as Capture;
    expect(alias.capturedAt).toBe(first.capturedAt);
    expect(alias.artifacts).toEqual(first.artifacts);
  });

  it('deduplicates identical grid bytes while retaining distinct event/product provenance', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    const second = await (await f.handler(request('/api/captures', { eventId: 'event-two' }), env)).json() as Capture;
    expect(first.product.id).toBe('product:event-one');
    expect(second.product.id).toBe('product:event-two');
    expect(first.artifacts.grid.sha256).toBe('48c9888fc2f87da3f92fab08e3f189eb778b23bb11b928bf8692888bc1ece6aa');
    expect(second.artifacts.grid.path).toBe(first.artifacts.grid.path);
    expect(f.writes()).toBe(3); // Two original details, one shared original grid.
    expect((await f.handler(request('/api/captures/event-one'), env)).status).toBe(200);
  });
});
