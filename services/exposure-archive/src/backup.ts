import { ArchiveError, type ArchiveDependencies, type RecoveryJob } from './types';
import { boundedBytes, hex } from './provider';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const snapshotKeys = ['artifacts', 'lifecycle', 'captures', 'versions', 'aliases', 'attempts', 'reconciliation', 'cleanupPlans', 'dailyUsage', 'dailyMaintenance', 'backupUsage'];
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', new Uint8Array(b)));
const summary = ({ snapshot, ...job }: RecoveryJob) => ({ ...job, artifactCount: job.artifacts.length, elapsedMs: Date.parse(job.completedAt ?? new Date().toISOString()) - Date.parse(job.createdAt) });
/** Object deadlines never authorize freeing uncertain uploads or reusing their keys. */
async function bounded<T>(fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new ArchiveError('object_store_unavailable', 'Recovery object operation was interrupted. Reserved bytes remain charged.', 503)), 15_000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
async function read(deps: ArchiveDependencies, key: string, expected?: { sha256: string; bytes: number }) {
    const object = await bounded(() => deps.bucket.get(key));
    if (!object) throw new ArchiveError('recovery_missing', 'A required recovery object is unavailable.', 409);
    const bytes = new Uint8Array(await bounded(() => boundedBytes(object.body, expected?.bytes ?? 2_000_000)));
    if (expected && (bytes.length !== expected.bytes || await sha(bytes) !== expected.sha256)) {
        throw new ArchiveError('recovery_checksum', 'A recovery object failed checksum verification.', 409);
    }
    return bytes;
}
/** R2 validates SHA-256 when an immutable generation is first written. Reuse its
 * server checksum without streaming unchanged originals on every daily point.
 * Imports lacking that checksum still require a complete byte verification. */
async function verifyRetained(deps: ArchiveDependencies, key: string, expected: { sha256: string; bytes: number }) {
    const object = await bounded(() => deps.bucket.head(key));
    if (!object) throw new ArchiveError('recovery_missing', 'A required recovery object is unavailable.', 409);
    if (object.size !== expected.bytes || (object.checksums.sha256 && hex(object.checksums.sha256) !== expected.sha256)) {
        throw new ArchiveError('recovery_checksum', 'A recovery object failed checksum verification.', 409);
    }
    if (!object.checksums.sha256) await read(deps, key, expected);
}
/** Each continuation owns a fresh fenced lease and processes at most four originals. */
export async function backupRequest(request: Request, deps: ArchiveDependencies, limits: {
    database: number;
    requests: number;
    objects: number;
    reserve: number;
}, admission?: {
    enter(): boolean;
    leave(): void;
}): Promise<Response> {
    const db = deps.database, path = new URL(request.url).pathname.slice('/api/maintenance/backups/'.length);
    if (!db.recoveryStart || !db.recoveryGet || !db.recoverySave || !db.recoverySnapshot || !db.recoveryReserve || !db.recoveryObjectState || !db.recoveryInventory || !db.recoveryRotate || !db.recoveryObject || !db.recoveryPublish)
        throw new ArchiveError('configuration_error', 'Recovery migration is unavailable.', 503);
    if (request.method === 'GET') {
        if (path === 'inventory') {
            const points = await db.recoveryInventory();
            return Response.json({ points: points.map(summary), latestCompleteAt: points.find(p => p.state === 'complete')?.completedAt ?? null });
        }
        const restore = path.startsWith('restore/'), id = restore ? path.slice(8) : path;
        if (!uuid.test(id))
            throw new ArchiveError('not_found', 'Recovery point unavailable.', 404);
        const job = await db.recoveryGet(id, restore);
        if (!job)
            throw new ArchiveError('not_found', 'Recovery point unavailable.', 404);
        return Response.json(summary(job));
    }
    if (request.method !== 'POST' || !['start', 'advance', 'restore/start', 'restore/advance', 'rotate'].includes(path))
        throw new ArchiveError('not_found', 'Recovery operation unavailable.', 404);
    let body: Record<string, unknown>;
    try {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
            throw Error();
        body = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 512)));
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw Error();
    }
    catch {
        throw new ArchiveError('invalid_request', 'Use a bounded JSON recovery request.', 400);
    }
    const keys = Object.keys(body).sort().join(',');
    if ((['start', 'rotate'].includes(path) && keys !== '') || (path.endsWith('advance') && (keys !== 'id' || typeof body.id !== 'string' || !uuid.test(body.id))) || (path === 'restore/start' && (keys !== 'confirmation,pointId' || body.confirmation !== 'RESTORE_EMPTY_ARCHIVE' || typeof body.pointId !== 'string' || !uuid.test(body.pointId))))
        throw new ArchiveError('invalid_request', 'Use the supported recovery fields and confirmation.', 400);
    if (admission && !admission.enter())
        throw new ArchiveError('capture_busy', 'Another archive operation is in progress.', 409);
    const owner = crypto.randomUUID();
    let acquired = false;
    try {
        acquired = await db.acquireMaintenance(owner, limits.database, limits.requests);
        if (!acquired)
            throw new ArchiveError('capture_busy', 'Another archive operation is in progress.', 409);
        if (path === 'rotate') {
            await db.recoveryGate?.(owner);
            if (!deps.bucket.delete)
                throw new ArchiveError('configuration_error', 'Object deletion unavailable.', 503);
            const objects = await db.recoveryRotate(owner);
            for (const o of objects) {
                await bounded(() => deps.bucket.delete!(o.key));
                if (await bounded(() => deps.bucket.head(o.key)))
                    throw new ArchiveError('object_store_unavailable', 'Deletion is unconfirmed; resume rotation.', 503);
                await db.recoveryObjectState(owner, o.key, 'deleted');
            }
            return Response.json({ deleted: objects.length });
        }
        if (path === 'start') {
            await db.recoveryGate?.(owner);
            const active = (await db.recoveryInventory()).find(point => point.state === 'building');
            if (active) return Response.json(summary(active));
            const snapshot = await db.recoverySnapshot(owner);
            if (encode(snapshot).length > 1000000)
                throw new ArchiveError('recovery_limit', 'Recovery metadata exceeds the bounded point limit.', 507);
            const refs = new Map<string, {
                sha256: string;
                bytes: number;
                sourceKey: string;
            }>();
            for (const row of snapshot.versions as Array<{
                manifest: {
                    artifacts: Record<string, {
                        sha256: string;
                        bytes: number;
                    }>;
                };
            }>) {
                for (const a of Object.values(row.manifest.artifacts)) {
                    const lifecycle = (snapshot.lifecycle as Array<{
                        sha256: string;
                        storage_key: string;
                    }>).find(l => l.sha256 === a.sha256);
                    refs.set(a.sha256, { sha256: a.sha256, bytes: a.bytes, sourceKey: lifecycle?.storage_key ?? `sha256/${a.sha256}` });
                }
            }
            if (refs.size > 256)
                throw new ArchiveError('recovery_limit', 'Recovery points support at most 256 distinct original objects.', 507);
            const job = await db.recoveryStart(owner, { id: crypto.randomUUID(), state: 'building', createdAt: new Date().toISOString(), snapshot, artifacts: [...refs.values()] }, false);
            return Response.json(summary(job));
        }
        if (path === 'restore/start') {
            const key = `backups/points/${body.pointId}.json`, bytes = await read(deps, key), envelope = JSON.parse(new TextDecoder().decode(bytes));
            if (envelope.format !== 'catlas-public-archive-v1' || typeof envelope.payload !== 'string' || await sha(new TextEncoder().encode(envelope.payload)) !== envelope.sha256)
                throw new ArchiveError('recovery_checksum', 'Recovery manifest checksum is invalid.', 409);
            const point = JSON.parse(envelope.payload) as RecoveryJob;
            if (point.id !== body.pointId || !point.snapshot || Object.keys(point.snapshot).sort().join(',') !== snapshotKeys.sort().join(',') || snapshotKeys.some(k => !Array.isArray(point.snapshot[k])) || !Array.isArray(point.artifacts) || point.artifacts.length > 256 || point.artifacts.some(a => !hash.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > 33554432 || !a.backupKey?.startsWith(`backups/content/${a.sha256}/`)))
                throw new ArchiveError('recovery_invalid', 'Recovery manifest structure is invalid.', 409);
            const references = new Map(point.artifacts.map(a => [a.sha256, a.bytes]));
            const metadata = new Map((point.snapshot.artifacts as Array<{ sha256: string; bytes: number }>).map(a => [a.sha256, Number(a.bytes)]));
            if (references.size !== point.artifacts.length || point.artifacts.some(a => metadata.get(a.sha256) !== a.bytes)) {
                throw new ArchiveError('recovery_invalid', 'Recovery artifact metadata is inconsistent.', 409);
            }
            type SnapshotCapture = { detail_sha256: string; grid_sha256: string; manifest: { artifacts: Record<string, { sha256: string; bytes: number }> } };
            for (const row of [...point.snapshot.versions, ...point.snapshot.captures] as SnapshotCapture[]) {
                const artifacts = row.manifest?.artifacts;
                if (!artifacts?.detail || !artifacts.grid || row.detail_sha256 !== artifacts.detail.sha256 || row.grid_sha256 !== artifacts.grid.sha256 ||
                    Object.values(artifacts).some(a => references.get(a.sha256) !== a.bytes || metadata.get(a.sha256) !== a.bytes)) {
                    throw new ArchiveError('recovery_invalid', 'Recovery references are incomplete.', 409);
                }
            }
            const job = await db.recoveryStart(owner, { ...point, id: crypto.randomUUID(), state: 'restoring', createdAt: new Date().toISOString(), manifestKey: key, manifestSha256: await sha(bytes), manifestBytes: bytes.length, artifacts: point.artifacts.map(a => ({ ...a, restored: false })) }, true);
            await db.setBackupUsage(owner, Number(job.snapshot.backupUsage[0] && ((job.snapshot.backupUsage[0] as {
                bytes: number;
            }).bytes)) || 0, limits.objects, limits.reserve);
            // Every supplied recovery object is charged before publishing live copies.
            for (const a of job.artifacts)
                await db.recoveryReserve(owner, { key: a.backupKey!, sha256: a.sha256, bytes: a.bytes, state: 'pending', kind: 'content' }, limits.objects, limits.reserve);
            await db.recoveryReserve(owner, { key, sha256: job.manifestSha256!, bytes: bytes.length, state: 'pending', kind: 'manifest' }, limits.objects, limits.reserve);
            return Response.json(summary(job));
        }
        const restore = path === 'restore/advance', job = await db.recoveryGet(body.id as string, restore);
        if (!job)
            throw new ArchiveError('not_found', 'Recovery point unavailable.', 404);
        if (job.state !== (restore ? 'restoring' : 'building'))
            return Response.json(summary(job));
        try {
            for (const a of job.artifacts.filter(a => restore ? !a.restored : !a.backupKey).slice(0, 4)) {
                if (restore) {
                    await db.setBackupUsage(owner, Number(job.snapshot.backupUsage[0] && ((job.snapshot.backupUsage[0] as {
                        bytes: number;
                    }).bytes)) || 0, limits.objects, limits.reserve);
                    await db.recoveryReserve(owner, { key: a.backupKey!, sha256: a.sha256, bytes: a.bytes, state: 'pending', kind: 'content' }, limits.objects, limits.reserve);
                    const bytes = await read(deps, a.backupKey!, a);
                    await db.reserve(owner, [{ sha256: a.sha256, bytes: a.bytes, path: '', sourceUrl: '', contentType: 'application/octet-stream' }], limits.objects, limits.reserve);
                    const key = `sha256/${a.sha256}/${job.id}`;
                    await bounded(() => deps.bucket.put(key, bytes.buffer as ArrayBuffer, { sha256: a.sha256, httpMetadata: { contentType: 'application/octet-stream' } }));
                    await read(deps, key, a);
                    await db.recoveryObjectState(owner, a.backupKey!, 'verified');
                    a.sourceKey = key;
                    a.restored = true;
                    await db.recoverySave(owner, job, true);
                }
                else {
                    const existing = await db.recoveryObject(a.sha256);
                    if (existing) {
                        await verifyRetained(deps, existing.key, a);
                        a.backupKey = existing.key;
                    }
                    else {
                        const bytes = await read(deps, a.sourceKey, a), key = `backups/content/${a.sha256}/${crypto.randomUUID()}`;
                        await db.recoveryReserve(owner, { key, sha256: a.sha256, bytes: a.bytes, state: 'pending', kind: 'content' }, limits.objects, limits.reserve);
                        await bounded(() => deps.bucket.put(key, bytes.buffer as ArrayBuffer, { sha256: a.sha256, httpMetadata: { contentType: 'application/octet-stream' } }));
                        await read(deps, key, a);
                        await db.recoveryObjectState(owner, key, 'verified');
                        a.backupKey = key;
                    }
                }
            }
            if (job.artifacts.every(a => restore ? a.restored : !!a.backupKey)) {
                if (restore) {
                    await db.recoveryReserve(owner, { key: job.manifestKey!, sha256: job.manifestSha256!, bytes: job.manifestBytes!, state: 'pending', kind: 'manifest' }, limits.objects, limits.reserve);
                    await db.recoveryObjectState(owner, job.manifestKey!, 'verified');
                    await db.recoveryPublish(owner, job);
                    job.state = 'complete';
                    job.completedAt = new Date().toISOString();
                }
                else {
                    const payload = JSON.stringify({ ...job, state: 'complete', completedAt: new Date().toISOString() }), bytes = encode({ format: 'catlas-public-archive-v1', sha256: await sha(new TextEncoder().encode(payload)), payload }), key = `backups/points/${job.id}.json`, digest = await sha(bytes);
                    if (bytes.length > 2_000_000) throw new ArchiveError('recovery_limit', 'The sealed recovery manifest exceeds the restore limit.', 507);
                    await db.recoveryReserve(owner, { key, sha256: digest, bytes: bytes.length, state: 'pending', kind: 'manifest' }, limits.objects, limits.reserve);
                    await bounded(() => deps.bucket.put(key, bytes.buffer as ArrayBuffer, { sha256: digest, httpMetadata: { contentType: 'application/json' } }));
                    await read(deps, key, { sha256: digest, bytes: bytes.length });
                    await db.recoveryObjectState(owner, key, 'verified');
                    job.manifestKey = key;
                    job.manifestSha256 = digest;
                    job.manifestBytes = bytes.length;
                    job.state = 'complete';
                    job.completedAt = new Date().toISOString();
                }
            }
            await db.recoverySave(owner, job, restore);
            return Response.json(summary(job));
        }
        catch (error) {
            if (!restore) {
                job.state = 'failed';
                job.error = error instanceof ArchiveError ? error.code : 'recovery_interrupted';
                await db.recoverySave(owner, job, false);
            }
            throw error;
        }
    }
    finally {
        if (acquired)
            await db.release(owner).catch(() => { });
        admission?.leave();
    }
}
