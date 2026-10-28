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
const ADMIN = 'private-admin-token-distinct-at-least-32chars';
const TOKEN = 'test-postgres-proof-token-32chars';
const env = { PROOF_TOKEN: TOKEN, ADMIN_TOKEN: ADMIN };
const request = (path: string, body?: unknown) => new Request(`https://proof.test${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${path.startsWith('/api/maintenance/') ? ADMIN : TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
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
    async delete(key) { objects.delete(key); },
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
  beforeEach(async () => { await psql("UPDATE catlas_proof_daily_maintenance SET usage_date = (clock_timestamp() AT TIME ZONE 'UTC')::date, requests = 0; UPDATE catlas_proof_backup_usage SET bytes = 0; UPDATE catlas_proof_daily_usage SET usage_date = (clock_timestamp() AT TIME ZONE 'UTC')::date, capture_attempts = 0; TRUNCATE catlas_proof_cleanup_plans, catlas_proof_artifact_lifecycle, catlas_proof_capture_versions, catlas_proof_attempts, catlas_proof_aliases, catlas_proof_captures, catlas_proof_artifact_reconciliation, catlas_proof_artifacts; UPDATE catlas_proof_capture_lease SET owner = NULL, expires_at = '-infinity'"); });

  it('previews only eligible old captured bytes without deleting any artifact', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at = clock_timestamp() - interval '91 days'; UPDATE catlas_proof_captures SET captured_at = clock_timestamp() - interval '91 days'");
    const preview = await f.handler(request('/api/maintenance/cleanup/preview', {}), env);
    expect(preview.status).toBe(200);
    const plan = await preview.json() as { artifacts: Array<{ sha256: string }>; state: string; confirmation: string; planId: string };
    expect(plan.state).toBe('preview'); expect(plan.confirmation).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.artifacts.map(item => item.sha256).sort()).toEqual(Object.values(first.artifacts).map(item => item.sha256).sort());
    expect((await f.handler(request(first.artifacts.grid.path), env)).status).toBe(200);
  });

  it('confirms an exact preview, retains expired metadata, and safely refetches the same original bytes', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'; UPDATE catlas_proof_captures SET captured_at=clock_timestamp()-interval '91 days'");
    const plan = await (await f.handler(request('/api/maintenance/cleanup/preview', {}), env)).json() as { planId: string; confirmation: string };
    const confirmation = await f.handler(request('/api/maintenance/cleanup/confirm', { planId: plan.planId, confirmation: plan.confirmation }), env);
    expect(confirmation.status).toBe(200); expect(await confirmation.json()).toMatchObject({state:'completed'});
    expect((await f.handler(request(first.artifacts.grid.path), env)).status).toBe(410);
    const expired = await f.handler(request('/api/captures/event-one'), env); expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({error:{code:'artifact_expired'},capture:{event:first.event,product:first.product}});
    expect(await (await f.handler(request('/api/maintenance/usage'), env)).json()).toMatchObject({reservedArtifactBytes:0});
    const repeated = await f.handler(request('/api/maintenance/cleanup/confirm', {planId:plan.planId,confirmation:plan.confirmation}), env);
    expect(repeated.status).toBe(200);
    const refetch = await f.handler(request('/api/captures', {eventId:'event-one'}), env); expect(refetch.status).toBe(201);
    const latest=await refetch.json() as Capture;expect(latest.artifacts.grid.sha256).toBe(first.artifacts.grid.sha256);
    expect(await (await f.handler(request(first.artifacts.grid.path), env)).text()).toBe(GRID);
    expect(await (await f.handler(request('/api/maintenance/cleanup/'+plan.planId),env)).json()).toMatchObject({state:'completed'});
    expect(await (await f.handler(request('/api/maintenance/usage'), env)).json()).toMatchObject({reservedArtifactBytes:first.artifacts.detail.bytes+first.artifacts.grid.bytes});
  });

  it('preserves cleanup expiry context when bounded refetch fails at the source', async () => {
    const f=setup(); await f.handler(request('/api/captures',{eventId:'event-one'}),env);
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string};
    await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env);
    f.deps.providerFetch=async()=>new Response('gone',{status:503});
    const result=await f.handler(request('/api/captures',{eventId:'event-one'}),env);
    expect(result.status).toBe(502);expect(await result.json()).toMatchObject({error:{code:'source_unavailable'},archiveEvidence:'expired'});
  });

  it('revalidates retention overrides before confirmation and preserves shared recent references', async () => {
    const f=setup();const first=await(await f.handler(request('/api/captures',{eventId:'event-one'}),env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    await f.handler(request('/api/captures',{eventId:'event-two'}),env);
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string;artifacts:Array<{sha256:string}>};
    expect(plan.artifacts.map(item=>item.sha256)).toEqual([first.artifacts.detail.sha256]);
    expect((await f.handler(request('/api/maintenance/retention',{sha256:first.artifacts.detail.sha256,retain:true}),env)).status).toBe(200);
    const confirmed=await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env);
    expect(await confirmed.json()).toMatchObject({state:'completed',artifacts:[{state:'skipped'}]});
    expect((await f.handler(request(first.artifacts.detail.path),env)).status).toBe(200);
    const next=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {artifacts:unknown[]};expect(next.artifacts).toEqual([]);
  });

  it('keeps interrupted deletion charged and resumes only the same explicit plan', async () => {
    const f=setup();const first=await(await f.handler(request('/api/captures',{eventId:'event-one'}),env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string};
    const remove=f.deps.bucket.delete!.bind(f.deps.bucket);let interrupted=true;
    f.deps.bucket.delete=async key=>{await remove(key);if(interrupted){interrupted=false;throw Error('lost delete acknowledgement');}};
    const failed=await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env);expect(failed.status).toBe(503);
    expect(await(await f.handler(request('/api/maintenance/usage'),env)).json()).toMatchObject({reservedArtifactBytes:first.artifacts.detail.bytes+first.artifacts.grid.bytes});
    expect((await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:'0'.repeat(64)}),env)).status).toBe(409);
    const resumed=await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env);expect(await resumed.json()).toMatchObject({state:'completed'});
    expect(await(await f.handler(request('/api/maintenance/usage'),env)).json()).toMatchObject({reservedArtifactBytes:0});
  });

  it('bounds confirmation batches and removes only old finished routine logs while retaining audit', async () => {
    const f=setup();for(let i=0;i<5;i++)await f.handler(request('/api/captures',{eventId:'old-'+i}),env);
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'; UPDATE catlas_proof_attempts SET finished_at=clock_timestamp()-interval '31 days'; INSERT INTO catlas_proof_attempts(event_id,owner,state,started_at,finished_at) VALUES('pending-log','00000000-0000-4000-8000-000000000001','pending',clock_timestamp()-interval '100 days',NULL),('recent-log','00000000-0000-4000-8000-000000000002','completed',clock_timestamp(),clock_timestamp()-interval '29 days')");
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string;artifacts:unknown[];logs:Array<{eventId:string}>};
    expect(plan.artifacts).toHaveLength(6);expect(plan.logs).toHaveLength(5);expect(plan.logs.map(item=>item.eventId)).not.toContain('pending-log');expect(plan.logs.map(item=>item.eventId)).not.toContain('recent-log');
    const first=await(await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env)).json() as {state:string;artifacts:Array<{state:string}>};
    expect(first.state).toBe('confirmed');expect(first.artifacts.filter(item=>item.state==='deleted')).toHaveLength(4);
    const complete=await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env);expect(await complete.json()).toMatchObject({state:'completed'});
    const audit=await(await f.handler(request('/api/maintenance/cleanup/'+plan.planId),env)).json() as {logs:Array<{state:string}>};expect(audit.logs.every(item=>item.state==='deleted')).toBe(true);
    const next=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {logs:unknown[]};expect(next.logs).toEqual([]);
  });

  it('never lets an older confirmed plan delete or uncharge a refetched physical generation', async () => {
    const f=setup();const first=await(await f.handler(request('/api/captures',{eventId:'event-one'}),env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    const stale=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string};
    await psql("UPDATE catlas_proof_cleanup_plans SET state='confirmed'");
    const newer=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string};
    await f.handler(request('/api/maintenance/cleanup/confirm',{planId:newer.planId,confirmation:newer.confirmation}),env);
    await f.handler(request('/api/captures',{eventId:'event-one'}),env);
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    expect(await(await f.handler(request('/api/maintenance/cleanup/confirm',{planId:stale.planId,confirmation:stale.confirmation}),env)).json()).toMatchObject({state:'completed',artifacts:[{state:'skipped'},{state:'skipped'}]});
    expect(await(await f.handler(request('/api/maintenance/usage'),env)).json()).toMatchObject({reservedArtifactBytes:first.artifacts.grid.bytes+first.artifacts.detail.bytes});
    expect(await(await f.handler(request(first.artifacts.grid.path),env)).text()).toBe(GRID);
  });

  it('excludes captured bytes with an expired but unsettled writer even before its late put completes', async () => {
    const f=setup();const first=await(await f.handler(request('/api/captures',{eventId:'event-one'}),env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    const upstream=f.deps.providerFetch;f.deps.providerFetch=async(...args)=>new Response((await(await upstream(...args)).text()).replaceAll('2000','3000'));
    const put=f.deps.bucket.put.bind(f.deps.bucket),head=f.deps.bucket.head.bind(f.deps.bucket);
    let resume!:()=>void,entered!:()=>void;const wait=new Promise<void>(resolve=>resume=resolve),began=new Promise<void>(resolve=>entered=resolve);
    let hide=true;f.deps.bucket.head=async key=>hide&&key===`sha256/${first.artifacts.grid.sha256}`?null:head(key);
    f.deps.bucket.put=async(key,value,options)=>{if(key===`sha256/${first.artifacts.grid.sha256}`){entered();await wait;}return put(key,value,options);};
    const updating=f.handler(request('/api/captures/check',{eventId:'event-one'}),env);
    await began;
    await psql("UPDATE catlas_proof_capture_lease SET expires_at=clock_timestamp()-interval '1 second'");
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {artifacts:Array<{sha256:string}>};
    expect(plan.artifacts.map(item=>item.sha256)).not.toContain(first.artifacts.grid.sha256);
    hide=false;resume();expect((await updating).status).toBe(409);
    expect(await(await f.handler(request(first.artifacts.grid.path),env)).text()).toBe(GRID);
    const usage=await(await f.handler(request('/api/maintenance/usage'),env)).json() as {reservedArtifactBytes:number};expect(usage.reservedArtifactBytes).toBeGreaterThan(first.artifacts.grid.bytes+first.artifacts.detail.bytes);
  });

  it('conservatively migrates a legacy captured artifact whose most recent writer was interrupted', async () => {
    const f=setup();const first=await(await f.handler(request('/api/captures',{eventId:'event-one'}),env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'; UPDATE catlas_proof_captures SET captured_at=clock_timestamp()-interval '91 days'; UPDATE catlas_proof_attempts SET state='interrupted'; DELETE FROM catlas_proof_artifact_lifecycle WHERE sha256='"+first.artifacts.grid.sha256+"'");
    await exec('psql',['-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55446','-U','catlas_test','-d','postgres','-f',new URL('../schema.sql',import.meta.url).pathname]);
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {artifacts:Array<{sha256:string}>};
    expect(plan.artifacts.map(item=>item.sha256)).toEqual([first.artifacts.detail.sha256]);
    expect((await f.handler(request(first.artifacts.grid.path),env)).status).toBe(200);
  });

  it('refuses an expired preview without deleting retained bytes', async () => {
    const f=setup();const first=await(await f.handler(request('/api/captures',{eventId:'event-one'}),env)).json() as Capture;
    await psql("UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days'");
    const plan=await(await f.handler(request('/api/maintenance/cleanup/preview',{}),env)).json() as {planId:string;confirmation:string};
    await psql("UPDATE catlas_proof_cleanup_plans SET expires_at=clock_timestamp()-interval '1 second'");
    expect((await f.handler(request('/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation}),env)).status).toBe(409);
    expect((await f.handler(request(first.artifacts.grid.path),env)).status).toBe(200);
  });

  it('publishes an explicitly requested revision while retaining the first original artifacts', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    const oldFetch = f.deps.providerFetch;
    f.deps.providerFetch = async (...args) => {
      const response = await oldFetch(...args);
      return new Response((await response.text()).replaceAll('2000', '3000').replaceAll('6.2', '3.2'));
    };
    const updated = await f.handler(request('/api/captures/check', { eventId: 'event-one' }), env);
    expect(updated.status).toBe(201);
    const second = await updated.json() as Capture;
    expect(second.product.updatedAt).toBe('1970-01-01T00:00:03.000Z');
    expect(second.artifacts.grid.sha256).not.toBe(first.artifacts.grid.sha256);
    expect(await (await f.handler(request(first.artifacts.grid.path), env)).text()).toBe(GRID);
    expect(await (await f.handler(request('/api/captures/event-one'), env)).json()).toMatchObject({ artifacts: second.artifacts });
    expect(await (await f.handler(request('/api/maintenance/usage'), env)).json()).toMatchObject({ abandonedArtifactBytes: 0, captureAttemptsToday: 2 });
  });

  it('retains one archive identity across a source-confirmed canonical event ID change', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    const upstream = f.deps.providerFetch;
    f.deps.providerFetch = async (...args) => {
      if (String(args[0]).includes('grid.xml')) throw new Error('An unchanged product grid must be reused.');
      const detail = await (await upstream(...args)).json() as { id: string; properties: { ids: string; updated: number } };
      detail.id = 'event-canonical'; detail.properties.ids = ',event-one,event-canonical,'; detail.properties.updated = 3000;
      return Response.json(detail);
    };
    const updated = await f.handler(request('/api/captures/check', { eventId: 'event-one' }), env);
    expect(updated.status).toBe(201);
    const next = await updated.json() as Capture;
    expect(next.event.id).toBe('event-canonical');
    expect(await (await f.handler(request('/api/captures/event-one'), env)).json()).toMatchObject({ event: next.event });
    expect(await (await f.handler(request('/api/captures/event-canonical'), env)).json()).toMatchObject({ event: next.event });
    expect((await f.handler(request(first.artifacts.detail.path), env)).status).toBe(200);
    expect((await f.handler(request('/api/captures/check', { eventId: 'event-one' }), env)).status).toBe(200);
  });

  it('refuses source aliases that would merge two retained archives and preserves both captures', async () => {
    const f = setup();
    const first = await (await f.handler(request('/api/captures', { eventId: 'event-one' }), env)).json() as Capture;
    const second = await (await f.handler(request('/api/captures', { eventId: 'event-two' }), env)).json() as Capture;
    const upstream = f.deps.providerFetch;
    f.deps.providerFetch = async (...args) => {
      if (String(args[0]).includes('grid.xml')) return upstream(...args);
      const detail = await (await upstream(...args)).json() as { properties: { ids: string } };
      detail.properties.ids = ',event-one,event-two,'; return Response.json(detail);
    };
    const refused = await f.handler(request('/api/captures/check', { eventId: 'event-one' }), env);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: 'identity_conflict' } });
    expect(await (await f.handler(request('/api/captures/event-one'), env)).json()).toMatchObject({ artifacts: first.artifacts });
    expect(await (await f.handler(request('/api/captures/event-two'), env)).json()).toMatchObject({ artifacts: second.artifacts });
  });

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
