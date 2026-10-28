import { beforeEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createArchiveHandler } from './archive';
import { createPostgresDatabase } from './neon';
import type { ArchiveDependencies, ObjectBucket } from './types';
const exec = promisify(execFile), args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55446', '-U', 'catlas_test', '-d', 'postgres'];
const psql = async (text: string) => (await exec('psql', [...args, '-c', text], { maxBuffer: 20 * 1024 * 1024 })).stdout;
const literal = (v: unknown) => v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
const db = (schema: string) => createPostgresDatabase(async (text, params) => JSON.parse(await psql(`SET search_path TO ${schema}; SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM (${text.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]))}) r`)));
const ADMIN = 'cat56-private-admin-32-characters', TOKEN = 'cat56-public-token-32-characters', env = { ADMIN_TOKEN: ADMIN, PROOF_TOKEN: TOKEN };
const json = async (response: Response): Promise<Record<string, any>> => JSON.parse(await response.text());
const request = (path: string, body?: unknown) => new Request('https://fixture.workers.dev' + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${path.startsWith('/api/maintenance/') ? ADMIN : TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function fixture(schema = 'cat56_source', objects = new Map<string, ArrayBuffer>()) {
    const bucket: ObjectBucket = { async head(key) { const b = objects.get(key); return b ? { size: b.byteLength, checksums: { sha256: await crypto.subtle.digest('SHA-256', b) } } : null; }, async get(key) { const b = objects.get(key); return b ? { size: b.byteLength, checksums: { sha256: await crypto.subtle.digest('SHA-256', b) }, body: new Response(b).body! } : null; }, async put(key, value, options) {
            const b = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer();
            const actual = Buffer.from(await crypto.subtle.digest('SHA-256', b)).toString('hex');
            if (actual !== options.sha256)
                throw Error('checksum');
            objects.set(key, b);
        }, async delete(key) { objects.delete(key); } };
    const deps: ArchiveDependencies = { database: db(schema), bucket, rateLimit: async () => true, providerFetch: async () => { throw Error('Backup must never acquire source data'); } };
    return { deps, objects, handler: createArchiveHandler(deps) };
}
async function originalFixture() {
    const f = fixture();
    const bytes = await new Response('original-public-data').arrayBuffer();
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    f.objects.set(`sha256/${hash}`, bytes);
    const artifact = { sha256: hash, bytes: bytes.byteLength, path: 'detail', sourceUrl: 'https://earthquake.usgs.gov/detail', contentType: 'application/json' };
    const capture = { artifacts: { detail: artifact, grid: artifact } };
    await psql(`SET search_path TO cat56_source;INSERT INTO catlas_proof_artifacts(sha256,bytes) VALUES('${hash}',${bytes.byteLength});INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key) VALUES('${hash}','sha256/${hash}');INSERT INTO catlas_proof_capture_versions VALUES('fixture','${hash}','${hash}',${literal(JSON.stringify(capture))}::jsonb,'2020-01-01');`);
    return { ...f, hash, bytes };
}
describe.runIf(process.env.CATLAS_POSTGRES_TEST === '1')('complete public archive recovery HTTP boundary', () => {
    beforeEach(async () => {
        const source = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
        for (const schema of ['cat56_source', 'cat56_target'])
            await psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}; ${source}`);
    });
    it('seals an empty point durably and restores after source metadata is lost', { timeout: 30000 }, async () => {
        const f = fixture();
        const started = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const advanced = await f.handler(request('/api/maintenance/backups/advance', { id: started.id }), env);
        expect(advanced.status).toBe(200);
        const point = await json(advanced);
        expect(point.state).toBe('complete');
        expect(f.objects.has(point.manifestKey)).toBe(true);
        const target = fixture('cat56_target', new Map(f.objects));
        const start = await target.handler(request('/api/maintenance/backups/restore/start', { pointId: point.id, confirmation: 'RESTORE_EMPTY_ARCHIVE' }), env);
        expect(start.status).toBe(200);
        const restore = await json(start);
        expect(restore.state).toBe('restoring');
        expect((await target.handler(request('/api/captures', { eventId: 'usfixture' }), env)).status).toBe(409);
        expect((await target.handler(request('/api/maintenance/cleanup/preview', {}), env)).status).toBe(409);
        expect((await target.handler(request('/api/maintenance/backups/start', {}), env)).status).toBe(409);
        const done = await target.handler(request('/api/maintenance/backups/restore/advance', { id: restore.id }), env);
        expect(done.status).toBe(200);
        expect(await done.json()).toMatchObject({ state: 'complete' });
    });
    it('copies every referenced original, deduplicates subsequent points and rejects a dirty restore target', { timeout: 30000 }, async () => {
        const f = fixture();
        const bytes = await new Response('original-public-data').arrayBuffer();
        const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
        f.objects.set(`sha256/${hash}`, bytes);
        const artifact = { sha256: hash, bytes: bytes.byteLength, path: 'detail', sourceUrl: 'https://earthquake.usgs.gov/detail', contentType: 'application/json' };
        const capture = { schemaVersion: 1, event: { id: 'usfixture', aliases: [], name: 'fixture', occurredAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' }, product: { id: 'fixture', source: 'us', code: 'fixture', updatedAt: '2020-01-01T00:00:00Z', retrospective: true }, capturedAt: '2020-01-01T00:00:00Z', artifacts: { detail: artifact, grid: artifact } };
        await psql(`SET search_path TO cat56_source;INSERT INTO catlas_proof_artifacts(sha256,bytes) VALUES('${hash}',${bytes.byteLength});INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key) VALUES('${hash}','sha256/${hash}');INSERT INTO catlas_proof_captures VALUES('usfixture','${hash}','${hash}',${literal(JSON.stringify(capture))}::jsonb,'2020-01-01');INSERT INTO catlas_proof_capture_versions SELECT * FROM catlas_proof_captures;UPDATE catlas_proof_daily_usage SET capture_attempts=7;INSERT INTO catlas_proof_artifact_reconciliation(sha256) VALUES('${hash}');`);
        const start = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const pinned = await json(await f.handler(request('/api/maintenance/cleanup/preview', {}), env));
        expect(pinned.artifacts).toEqual([]);
        const done = await json(await f.handler(request('/api/maintenance/backups/advance', { id: start.id }), env));
        expect(done.state).toBe('complete');
        expect(done.artifacts).toHaveLength(1);
        const second = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        expect((await json(await f.handler(request('/api/maintenance/backups/advance', { id: second.id }), env))).state).toBe('complete');
        expect([...f.objects.keys()].filter(k => k.startsWith('backups/content/'))).toHaveLength(1);
        const recovery = new Map([...f.objects].filter(([k]) => k === done.manifestKey || k === done.artifacts[0].backupKey));
        const target = fixture('cat56_target', recovery);
        const restore = await json(await target.handler(request('/api/maintenance/backups/restore/start', { pointId: done.id, confirmation: 'RESTORE_EMPTY_ARCHIVE' }), env));
        const result = await target.handler(request('/api/maintenance/backups/restore/advance', { id: restore.id }), env);
        expect(result.status).toBe(200);
        expect(await json(result)).toMatchObject({ state: 'complete' });
        const read = await target.handler(request(`/api/artifacts/${hash}`), env);
        expect(read.status).toBe(200);
        expect(await read.text()).toBe('original-public-data');
        expect((await json(await target.handler(request('/api/maintenance/usage'), env))).captureAttemptsToday).toBe(7);
        const cleanup = await json(await target.handler(request('/api/maintenance/cleanup/preview', {}), env));
        expect(cleanup.artifacts).toHaveLength(1);
        expect((await target.handler(request('/api/maintenance/backups/restore/start', { pointId: done.id, confirmation: 'RESTORE_EMPTY_ARCHIVE' }), env)).status).toBe(409);
    });
    it('reuses a verified immutable backup when its body read is unavailable but its server checksum remains valid', { timeout: 30000 }, async () => {
        const f = await originalFixture();
        const first = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const complete = await json(await f.handler(request('/api/maintenance/backups/advance', { id: first.id }), env));
        expect(complete.state).toBe('complete');
        const get = f.deps.bucket.get.bind(f.deps.bucket);
        f.deps.bucket.get = async key => {
            if (key === complete.artifacts[0].backupKey) throw Error('Object body temporarily unavailable');
            return get(key);
        };
        const second = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const response = await f.handler(request('/api/maintenance/backups/advance', { id: second.id }), env);
        expect(response.status).toBe(200);
        const sealed = await json(response);
        expect(sealed.state).toBe('complete');
        expect(sealed.artifacts[0].backupKey).toBe(complete.artifacts[0].backupKey);
        expect((await json(await f.handler(request('/api/maintenance/backups/' + first.id), env))).state).toBe('complete');
    });
    for (const hasServerChecksum of [true, false]) {
        it(`rejects corrupted retained backup content with ${hasServerChecksum ? 'a mismatching' : 'no'} server checksum`, { timeout: 30000 }, async () => {
            const f = await originalFixture();
            const first = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
            const complete = await json(await f.handler(request('/api/maintenance/backups/advance', { id: first.id }), env));
            expect(complete.state).toBe('complete');
            const key = complete.artifacts[0].backupKey;
            f.objects.set(key, await new Response('corrupted-public-dat').arrayBuffer());
            if (!hasServerChecksum) {
                const head = f.deps.bucket.head.bind(f.deps.bucket);
                f.deps.bucket.head = async candidate => candidate === key ? { size: f.bytes.byteLength, checksums: {} } : head(candidate);
            }
            const second = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
            const response = await f.handler(request('/api/maintenance/backups/advance', { id: second.id }), env);
            expect(response.status).toBe(409);
            expect((await json(response)).error.code).toBe('recovery_checksum');
            expect((await json(await f.handler(request('/api/maintenance/backups/' + second.id), env))).state).toBe('failed');
            expect([...f.objects.keys()].filter(k => k.startsWith('backups/points/'))).toHaveLength(1);
        });
    }
    it('verifies imported backup bytes before reuse when a server checksum is absent', { timeout: 30000 }, async () => {
        const f = await originalFixture();
        const first = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const complete = await json(await f.handler(request('/api/maintenance/backups/advance', { id: first.id }), env));
        expect(complete.state).toBe('complete');
        const key = complete.artifacts[0].backupKey;
        const head = f.deps.bucket.head.bind(f.deps.bucket);
        f.deps.bucket.head = async candidate => candidate === key ? { size: f.bytes.byteLength, checksums: {} } : head(candidate);
        const second = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const response = await f.handler(request('/api/maintenance/backups/advance', { id: second.id }), env);
        expect(response.status).toBe(200);
        expect((await json(response)).state).toBe('complete');
    });
    it('fails honestly when an original is missing and never seals a metadata-only point', { timeout: 30000 }, async () => {
        const f = fixture();
        const hash = 'a'.repeat(64);
        const capture = { artifacts: { detail: { sha256: hash, bytes: 5 }, grid: { sha256: hash, bytes: 5 } } };
        await psql(`SET search_path TO cat56_source;INSERT INTO catlas_proof_artifacts(sha256,bytes) VALUES('${hash}',5);INSERT INTO catlas_proof_capture_versions VALUES('fixture','${hash}','${hash}',${literal(JSON.stringify(capture))}::jsonb,now());`);
        const start = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        expect((await f.handler(request('/api/maintenance/backups/advance', { id: start.id }), env)).status).toBe(409);
        expect((await json(await f.handler(request('/api/maintenance/backups/' + start.id), env))).state).toBe('failed');
        expect([...f.objects.keys()].some(k => k.startsWith('backups/points/'))).toBe(false);
    });
    it('retains 30 days, resumes interrupted rotation and charges uncertain writes', { timeout: 30000 }, async () => {
        const f = fixture();
        const start = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const point = await json(await f.handler(request('/api/maintenance/backups/advance', { id: start.id }), env));
        await psql(`SET search_path TO cat56_source;UPDATE catlas_proof_recovery_points SET document=jsonb_set(document,'{createdAt}',to_jsonb((clock_timestamp()-interval '31 days')::text));`);
        let fail = true;
        f.deps.bucket.delete = async (key) => {
            if (fail) {
                fail = false;
                throw Error('interrupted delete');
            }
            f.objects.delete(key);
        };
        expect((await f.handler(request('/api/maintenance/backups/rotate', {}), env)).status).toBeGreaterThanOrEqual(500);
        expect((await json(await f.handler(request('/api/maintenance/usage'), env))).recordedBackupBytes).toBeGreaterThan(0);
        expect((await json(await f.handler(request('/api/maintenance/backups/rotate', {}), env))).deleted).toBe(1);
        expect(f.objects.has(point.manifestKey)).toBe(false);
        const next = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        f.deps.bucket.put = async (key, value) => { const bytes = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer(); f.objects.set(key, bytes); throw Error('uncertain upload acknowledgement'); };
        expect((await f.handler(request('/api/maintenance/backups/advance', { id: next.id }), env)).status).toBeGreaterThanOrEqual(500);
        expect((await json(await f.handler(request('/api/maintenance/usage'), env))).recordedBackupBytes).toBeGreaterThan(0);
        expect((await json(await f.handler(request('/api/maintenance/backups/rotate', {}), env))).deleted).toBe(0);
    });
    it('rejects a corrupted original without sealing a recovery point', { timeout: 30000 }, async () => {
        const f = await originalFixture();
        f.objects.set(`sha256/${f.hash}`, await new Response('corrupted-public-dat').arrayBuffer());
        const start = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        const result = await f.handler(request('/api/maintenance/backups/advance', { id: start.id }), env);
        expect(result.status).toBe(409);
        expect((await json(result)).error.code).toBe('recovery_checksum');
        expect((await json(await f.handler(request('/api/maintenance/backups/' + start.id), env))).state).toBe('failed');
        expect([...f.objects.keys()].some(k => k.startsWith('backups/points/'))).toBe(false);
    });
    it('refuses recovery growth over the combined budget and keeps successfully copied bytes charged', { timeout: 30000 }, async () => {
        const f = await originalFixture(), small = { ...env, MAX_R2_BYTES: '100', BACKUP_RESERVED_BYTES: '1' };
        const start = await json(await f.handler(request('/api/maintenance/backups/start', {}), small));
        const result = await f.handler(request('/api/maintenance/backups/advance', { id: start.id }), small);
        expect(result.status).toBe(507);
        expect((await json(result)).error.code).toBe('capacity_exceeded');
        const usage = await json(await f.handler(request('/api/maintenance/usage'), small));
        expect(usage.recordedBackupBytes).toBe(f.bytes.byteLength);
        expect(usage.reservedArtifactBytes).toBe(f.bytes.byteLength);
        expect((await json(await f.handler(request('/api/maintenance/backups/' + start.id), small))).state).toBe('failed');
        expect([...f.objects.keys()].filter(k => k.startsWith('backups/content/'))).toHaveLength(1);
        expect([...f.objects.keys()].some(k => k.startsWith('backups/points/'))).toBe(false);
    });
    it('pins a building point fallback while the prior complete point expires after live cleanup', { timeout: 30000 }, async () => {
        const f = await originalFixture();
        const first = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        expect((await json(await f.handler(request('/api/maintenance/backups/advance', { id: first.id }), env))).state).toBe('complete');
        const plan = await json(await f.handler(request('/api/maintenance/cleanup/preview', {}), env));
        expect((await json(await f.handler(request('/api/maintenance/cleanup/confirm', { planId: plan.planId, confirmation: plan.confirmation }), env))).state).toBe('completed');
        expect(f.objects.has(`sha256/${f.hash}`)).toBe(false);
        const building = await json(await f.handler(request('/api/maintenance/backups/start', {}), env));
        await psql(`SET search_path TO cat56_source;UPDATE catlas_proof_recovery_points SET document=jsonb_set(document,'{createdAt}',to_jsonb((clock_timestamp()-interval '31 days')::text)) WHERE id='${first.id}';`);
        await f.handler(request('/api/maintenance/backups/rotate', {}), env);
        const advanced = await f.handler(request('/api/maintenance/backups/advance', { id: building.id }), env);
        expect(advanced.status).toBe(200);
        expect((await json(advanced)).state).toBe('complete');
    });
    it('starts an explicitly requested recovery point without claiming partial work complete', { timeout: 30000 }, async () => {
        const f = fixture();
        const result = await f.handler(request('/api/maintenance/backups/start', {}), env);
        expect(result.status).toBe(200);
        expect(await result.json()).toMatchObject({ state: 'building' });
    });
});
