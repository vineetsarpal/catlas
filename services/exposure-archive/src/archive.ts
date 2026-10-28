import { backupRequest } from './backup';
import { cleanupRequest } from './cleanup';
import { ArchiveError, type ArchiveDependencies, type Artifact, type Capture, type ObjectBucket } from './types';
import { boundedBytes, EVENT_ID, fetchEvidence, hash, hex, selectEvidence, prepareGrid, writePreparedGrid, writeBufferedArtifact, type PreparedGrid } from './provider';
import { createNeonDatabase } from './neon';
import { providerFailure } from './provider-errors';
import { discoverCatalog } from './discovery';
export interface Env {
  PROOF_TOKEN: string; ADMIN_TOKEN?: string; DATABASE_URL?: string; ARTIFACTS?: R2Bucket; ASSETS?: Fetcher; REQUEST_LIMITER?: RateLimit;
  MAX_GRID_BYTES?: string; MAX_DETAIL_BYTES?: string; MAX_DATABASE_BYTES?: string; MAX_R2_BYTES?: string; BACKUP_RESERVED_BYTES?: string; MAX_CAPTURE_ATTEMPTS_PER_DAY?: string; MAX_MAINTENANCE_REQUESTS_PER_DAY?: string;
}
type Timing = Record<string, number>;
export interface CaptureAdmission { enter(): boolean; leave(): void }
const configured = (value: string | undefined, fallback: number, ceiling: number) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > ceiling) throw new ArchiveError('configuration_error', 'A proof resource limit is invalid.', 503);
  return n;
};
async function authenticated(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 24) return false;
  const actual = request.headers.get('authorization') ?? '';
  if (actual.length > 512) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actual)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`Bearer ${token}`)));
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0;
}
async function objectStoreCall<T>(work: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new ArchiveError('object_store_unavailable', 'The public evidence object store timed out. Retry explicitly.', 503)), 15_000);
    })]);
  } catch (error) {
    const classified = providerFailure(error, 'R2');
    if (classified) throw classified;
    throw new ArchiveError('object_store_unavailable', 'The public evidence object store is unavailable. Retry explicitly.', 503);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
async function objectValid(bucket: ObjectBucket, artifact: Artifact): Promise<boolean> {
  const object = await objectStoreCall(() => bucket.head(`sha256/${artifact.sha256}`));
  return object?.size === artifact.bytes && !!object.checksums.sha256 && hex(object.checksums.sha256) === artifact.sha256;
}
const sameProductMetadata = (a: Capture['product'], b: Capture['product']) =>
  a.id === b.id && a.source === b.source && a.code === b.code && a.updatedAt === b.updatedAt && a.retrospective === b.retrospective;
const sameEventMetadata = (a: Capture['event'], b: Capture['event']) =>
  a.id === b.id && a.name === b.name && a.occurredAt === b.occurredAt && a.updatedAt === b.updatedAt &&
  [...a.aliases].sort().join(',') === [...b.aliases].sort().join(',');
/** Only a source metadata check timestamp may change without revising frozen observations. */
async function unchangedDetail(deps: ArchiveDependencies, retained: Artifact, detail: ArrayBuffer): Promise<boolean> {
  if (retained.sha256 === await hash(detail)) return true;
  const stored = await objectStoreCall(() => deps.bucket.get(`sha256/${retained.sha256}`));
  if (!stored || stored.size !== retained.bytes || !stored.checksums.sha256 || hex(stored.checksums.sha256) !== retained.sha256) throw new ArchiveError('artifact_unavailable', 'Captured event detail is unavailable.', 503);
  const original = await boundedBytes(stored.body, 8_388_608);
  if (await hash(original) !== retained.sha256) throw new ArchiveError('artifact_integrity', 'Captured event detail failed verification.', 503);
  const comparable = (bytes: ArrayBuffer) => {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value.properties && typeof value.properties === 'object') delete value.properties.updated;
    return JSON.stringify(value);
  };
  return comparable(original) === comparable(detail);
}
async function expired(deps: ArchiveDependencies, capture: Capture): Promise<boolean> {
  if(!deps.database.artifactState)return false;
  for(const artifact of Object.values(capture.artifacts))if(await deps.database.artifactState(artifact.sha256)!=='present')return true;
  return false;
}
function mappedDependencies(deps:ArchiveDependencies):ArchiveDependencies {
  if(!deps.database.objectKey)return deps;
  const key=async(value:string)=>/^sha256\/[a-f0-9]{64}$/.test(value)?deps.database.objectKey!(value.slice(7)):value;
  return {...deps,bucket:{head:async(value)=>deps.bucket.head(await key(value)),get:async(value)=>deps.bucket.get(await key(value)),put:async(value,bytes,options)=>deps.bucket.put(await key(value),bytes,options),...(deps.bucket.delete?{delete:deps.bucket.delete.bind(deps.bucket)}:{})}};
}
async function captureEvent(eventId: string, env: Env, deps: ArchiveDependencies, timings: Timing, checkSource = false): Promise<{ capture: Capture; cache: 'hit' | 'miss' }> {
  const timed = async <T>(name: string, work: () => Promise<T>): Promise<T> => { const start = performance.now(); try { return await work(); } finally { timings[name] = (timings[name] ?? 0) + performance.now() - start; } };
  const cached = await timed('database', () => deps.database.lookup(eventId));
  if (cached && !checkSource && !await expired(deps,cached)) {
    for (const artifact of Object.values(cached.artifacts)) if (!await timed('objectStore', () => objectValid(deps.bucket, artifact))) throw new ArchiveError('artifact_unavailable', 'Captured evidence is incomplete or unavailable. No replacement was selected.', 503);
    return { capture: cached, cache: 'hit' };
  }
  const maximumDatabase = configured(env.MAX_DATABASE_BYTES, 800_000_000, 800_000_000);
  const maximumObjects = configured(env.MAX_R2_BYTES, 8_000_000_000, 8_000_000_000);
  const backupReserve = configured(env.BACKUP_RESERVED_BYTES, 128_000_000, maximumObjects);
  const owner = crypto.randomUUID();
  if (!await timed('database', () => deps.database.acquire(owner, maximumDatabase, eventId, { maxCaptureAttempts: configured(env.MAX_CAPTURE_ATTEMPTS_PER_DAY, 100, 1000), maxObjectBytes: maximumObjects, backupReserve }))) throw new ArchiveError('capture_busy', 'Another capture is in progress. Retry explicitly after it finishes.', 409);
  let grid: PreparedGrid | undefined;
  let sourceController: AbortController | undefined;
  let sourceTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const recheck = await timed('database', () => deps.database.lookup(eventId));
    if (recheck && !checkSource && !await expired(deps,recheck)) {
      for (const item of Object.values(recheck.artifacts)) if (!await timed('objectStore', () => objectValid(deps.bucket, item))) throw new ArchiveError('artifact_unavailable', 'Captured evidence is incomplete or unavailable.', 503);
      return { capture: recheck, cache: 'hit' };
    }
    sourceController = new AbortController();
    sourceTimeout = setTimeout(() => sourceController!.abort(new DOMException('Source acquisition deadline exceeded.', 'TimeoutError')), 60_000);
    const signal = sourceController.signal;
    const detailUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(eventId)}`;
    const detail = await timed('provider', () => fetchEvidence(deps.providerFetch, detailUrl, configured(env.MAX_DETAIL_BYTES, 2_097_152, 8_388_608), signal));
    const selected = selectEvidence(detail);
    const candidate = await timed('database', () => deps.database.lookup(selected.event.id)) ??
      (checkSource && cached && selected.event.aliases.includes(cached.event.id) ? cached : null);
    const canonical = candidate && await expired(deps,candidate) ? null : candidate;
    const sameProduct = canonical && sameProductMetadata(canonical.product, selected.product) && canonical.artifacts.grid.sourceUrl === selected.gridUrl &&
      (selected.sourceGridBytes === undefined || selected.sourceGridBytes === canonical.artifacts.grid.bytes) &&
      (selected.sourceGridHash === undefined || selected.sourceGridHash.toLowerCase() === canonical.artifacts.grid.sha256 || selected.sourceGridHash === btoa(String.fromCharCode(...Uint8Array.from(canonical.artifacts.grid.sha256.match(/../g)!, byte => parseInt(byte, 16)))));
    if (canonical && (!checkSource || (sameProduct && await unchangedDetail(deps, canonical.artifacts.detail, detail)))) {
      for (const item of Object.values(canonical.artifacts)) if (!await timed('objectStore', () => objectValid(deps.bucket, item))) throw new ArchiveError('artifact_unavailable', 'Captured evidence is incomplete or unavailable.', 503);
      await timed('database', () => deps.database.associate(owner, eventId, canonical.event.id));
      return { capture: canonical, cache: 'hit' };
    }
    if (sameProduct) {
      if (!await timed('objectStore', () => objectValid(deps.bucket, canonical.artifacts.grid))) throw new ArchiveError('artifact_unavailable', 'Captured grid is unavailable.', 503);
    } else grid = await timed('provider', () => prepareGrid(deps.providerFetch, selected, configured(env.MAX_GRID_BYTES, 33_554_432, 33_554_432), signal));
    const detailHash = await hash(detail);
    const captured: Capture = { schemaVersion: 1, event: selected.event, product: selected.product, capturedAt: new Date().toISOString(), artifacts: {
      detail: { sha256: detailHash, bytes: detail.byteLength, sourceUrl: detailUrl, contentType: 'application/geo+json', path: `/api/artifacts/${detailHash}` },
      grid: sameProduct ? canonical.artifacts.grid : { sha256: grid!.sha256, bytes: grid!.bytes, sourceUrl: selected.gridUrl, contentType: 'application/xml', path: `/api/artifacts/${grid!.sha256}` },
    } };
    await timed('database', () => deps.database.reserve(owner, Object.values(captured.artifacts), maximumObjects, backupReserve));
    for (const name of ['detail', 'grid'] as const) {
      const item = captured.artifacts[name];
      await timed('objectStore', async () => {
        if (!await objectValid(deps.bucket, item)) {
          if (name === 'grid') await objectStoreCall(() => writePreparedGrid(deps.bucket, grid!, item, signal));
          else await objectStoreCall(() => writeBufferedArtifact(deps.bucket, detail, item, signal));
        }
        if (!await objectValid(deps.bucket, item)) throw new ArchiveError('artifact_integrity', 'Object storage did not confirm the original evidence checksum.', 503);
      });
    }
    try { await timed('database', () => deps.database.publish(owner, captured)); }
    catch (error) {
      // The transaction may have committed even when its HTTP acknowledgement was lost.
      let readbackError: unknown;
      const retained = await timed('database', () => deps.database.lookup(selected.event.id)).catch(error => { readbackError = error; return null; });
      if (retained && sameEventMetadata(retained.event, captured.event) && sameProductMetadata(retained.product, captured.product) && retained.artifacts.grid.sha256 === captured.artifacts.grid.sha256 && retained.artifacts.detail.sha256 === captured.artifacts.detail.sha256) {
        for (const artifact of Object.values(retained.artifacts)) if (!await objectValid(deps.bucket, artifact)) throw new ArchiveError('artifact_unavailable', 'Captured evidence is incomplete or unavailable.', 503);
        return { capture: retained, cache: 'hit' };
      }
      const providerError = [error, readbackError].find((item): item is ArchiveError => item instanceof ArchiveError && ['provider_quota', 'provider_suspended'].includes(item.code));
      if (providerError) throw new ArchiveError(providerError.code, `${providerError.message} Publication could not be confirmed; retrieve or retry explicitly.`, providerError.status);
      if (error instanceof ArchiveError && ['identity_conflict', 'capture_interrupted'].includes(error.code)) throw error;
      throw new ArchiveError('capture_uncertain', 'Publication could not be confirmed. Retrieve or retry explicitly; no replacement was selected.', 503);
    }
    return { capture: captured, cache: 'miss' };
  } finally {
    if (sourceTimeout !== undefined) clearTimeout(sourceTimeout);
    sourceController?.abort(new DOMException('Source acquisition finished.', 'AbortError'));
    await grid?.source?.cancel().catch(() => {});
    // Cleanup is best effort: an unacknowledged release expires through the fenced lease.
    // It must never turn an already committed capture into an apparent failure.
    await timed('database', () => deps.database.release(owner)).catch(() => {});
  }
}
/** Explicit private maintenance classifies at most sixteen reservations; it never frees their charge. */
async function reconcile(env: Env, deps: ArchiveDependencies): Promise<Response> {
  const owner = crypto.randomUUID();
  if (!await deps.database.acquireMaintenance(owner, configured(env.MAX_DATABASE_BYTES, 800_000_000, 800_000_000), configured(env.MAX_MAINTENANCE_REQUESTS_PER_DAY, 20, 100))) throw new ArchiveError('capture_busy', 'Another capture is in progress. Retry explicitly after it finishes.', 409);
  const summary = { checked: 0, present: 0, missing: 0, invalid: 0, retainedBytes: 0 };
  try {
    await deps.database.recoveryGate?.(owner);
    const candidates = await deps.database.orphanCandidates(owner, 16);
    for (const artifact of candidates.slice(0, 16)) {
      const stored = await objectStoreCall(() => deps.bucket.head(`sha256/${artifact.sha256}`));
      const state = !stored ? 'missing' : stored.size === artifact.bytes && stored.checksums.sha256 && hex(stored.checksums.sha256) === artifact.sha256 ? 'present' : 'invalid';
      await deps.database.recordOrphan(owner, artifact.sha256, state);
      summary.checked++; summary[state]++; summary.retainedBytes += artifact.bytes;
    }
    return Response.json(summary);
  } finally { await deps.database.release(owner).catch(() => {}); }
}
async function handle(request: Request, env: Env, dependencies: () => Promise<ArchiveDependencies>, admission?: CaptureAdmission): Promise<Response> {
  let expiredRefetch=false;
  const start = performance.now(); const requestId = crypto.randomUUID(); const timings: Timing = {};
  const respond = (response: Response) => {
    timings.total = performance.now() - start;
    response.headers.set('X-Request-Id', requestId); response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Server-Timing', Object.entries(timings).map(([name, ms]) => `${name};dur=${ms.toFixed(2)}`).join(', '));
    response.headers.set('X-Content-Type-Options', 'nosniff'); return response;
  };
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : respond(new Response('Not found.', { status: 404 }));
    const admin = url.pathname.startsWith('/api/maintenance/');
    if (!await authenticated(request, admin && env.ADMIN_TOKEN !== env.PROOF_TOKEN ? env.ADMIN_TOKEN : admin ? undefined : env.PROOF_TOKEN)) throw new ArchiveError('unauthorized', admin ? 'A valid private maintenance credential is required.' : 'A valid proof token is required.', 401);
    const catalog = url.pathname === '/api/catalog' && request.method === 'GET';
    const checkSource = url.pathname === '/api/captures/check' && request.method === 'POST';
    if (url.search && !catalog) throw new ArchiveError('invalid_request', 'API query parameters are not accepted.', 400);
    if (url.pathname.startsWith('/api/maintenance/cleanup/') || url.pathname === '/api/maintenance/retention') {
      const deps = await dependencies();
      if (!await deps.rateLimit(request.method==='GET'?'read':'mutation')) throw new ArchiveError('rate_limited','The private request allowance was reached.',429);
      return respond(await cleanupRequest(request,deps,{database:configured(env.MAX_DATABASE_BYTES,800_000_000,800_000_000),requests:configured(env.MAX_MAINTENANCE_REQUESTS_PER_DAY,20,100)},admission));
    }
    if (url.pathname.startsWith('/api/maintenance/backups/')) {
      const deps=await dependencies();
      if (!await deps.rateLimit(request.method==='GET'?'read':'mutation')) throw new ArchiveError('rate_limited','The private request allowance was reached.',429);
      const maxObjectBytes = configured(env.MAX_R2_BYTES,8_000_000_000,8_000_000_000);
      return respond(await backupRequest(request,deps,{database:configured(env.MAX_DATABASE_BYTES,800_000_000,800_000_000),requests:configured(env.MAX_MAINTENANCE_REQUESTS_PER_DAY,20,100),objects:maxObjectBytes,reserve:configured(env.BACKUP_RESERVED_BYTES,128_000_000,maxObjectBytes)},admission));
    }
    let eventId: string | undefined; let backupBytes: number | undefined;
    const usage = url.pathname === '/api/maintenance/usage' && request.method === 'GET';
    const backupUpdate = url.pathname === '/api/maintenance/backup-usage' && request.method === 'POST';
    const maintenance = url.pathname === '/api/maintenance/reconcile' && request.method === 'POST';
    const cachedMatch = url.pathname.match(/^\/api\/captures\/([a-zA-Z0-9_-]{1,100})$/);
    const artifactMatch = url.pathname.match(/^\/api\/artifacts\/([a-f0-9]{64})$/);
    if ((url.pathname === '/api/captures' && request.method === 'POST') || checkSource || maintenance || backupUpdate) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ArchiveError('invalid_request', 'Use application/json for capture requests.', 400);
      let value: unknown;
      try { value = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 256))); } catch (e) { if (e instanceof ArchiveError && e.status === 413) throw e; value = null; }
      if (backupUpdate) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('bytes' in value) || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 8_000_000_000) throw new ArchiveError('invalid_request', 'Send only nonnegative whole backup bytes.', 400);
        backupBytes = value.bytes;
      } else if (maintenance) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new ArchiveError('invalid_request', 'Send an empty JSON object for reconciliation.', 400);
      } else {
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('eventId' in value) || typeof value.eventId !== 'string' || !EVENT_ID.test(value.eventId)) throw new ArchiveError('invalid_request', 'Send only a valid USGS eventId.', 400);
      eventId = value.eventId;
      }
    } else if (!(request.method === 'GET' && (cachedMatch || artifactMatch || usage || catalog))) throw new ArchiveError('not_found', 'This proof endpoint or method does not exist.', 404);
    const deps = mappedDependencies(await dependencies());
    if (!await deps.rateLimit(request.method === 'GET' ? 'read' : 'mutation')) throw new ArchiveError('rate_limited', 'The proof request limit was reached. Retry later.', 429);
    if (catalog) return respond(Response.json(await discoverCatalog(deps.providerFetch, url.searchParams)));
    if (usage) {
      const current = await deps.database.usage();
      const maxObjectBytes = configured(env.MAX_R2_BYTES, 8_000_000_000, 8_000_000_000);
      const backupReserve = configured(env.BACKUP_RESERVED_BYTES, 128_000_000, maxObjectBytes);
      const effectiveBackupBytes = Math.max(backupReserve, current.recordedBackupBytes);
      const accountedObjectBytes = current.reservedArtifactBytes + effectiveBackupBytes;
      return respond(Response.json({ ...current, maxDatabaseBytes: configured(env.MAX_DATABASE_BYTES, 800_000_000, 800_000_000), maxObjectBytes, backupReserve, effectiveBackupBytes, accountedObjectBytes, availableObjectBytes: Math.max(0, maxObjectBytes - accountedObjectBytes), maxCaptureAttempts: configured(env.MAX_CAPTURE_ATTEMPTS_PER_DAY, 100, 1000), maxMaintenanceRequests: configured(env.MAX_MAINTENANCE_REQUESTS_PER_DAY, 20, 100) }));
    }
    if (backupBytes !== undefined) {
      if (admission && !admission.enter()) throw new ArchiveError('capture_busy', 'Another capture is in progress. Retry explicitly after it finishes.', 409);
      const owner = crypto.randomUUID(); let acquired = false;
      try {
        acquired = await deps.database.acquireMaintenance(owner, configured(env.MAX_DATABASE_BYTES, 800_000_000, 800_000_000), configured(env.MAX_MAINTENANCE_REQUESTS_PER_DAY, 20, 100));
        if (!acquired) throw new ArchiveError('capture_busy', 'Another capture is in progress. Retry explicitly after it finishes.', 409);
        await deps.database.recoveryGate?.(owner);
        const maxObjectBytes = configured(env.MAX_R2_BYTES, 8_000_000_000, 8_000_000_000);
        await deps.database.setBackupUsage(owner, backupBytes, maxObjectBytes, configured(env.BACKUP_RESERVED_BYTES, 128_000_000, maxObjectBytes));
        return respond(Response.json({ recordedBackupBytes: backupBytes }));
      } finally { if (acquired) await deps.database.release(owner).catch(() => {}); admission?.leave(); }
    }
    if (maintenance) {
      if (admission && !admission.enter()) throw new ArchiveError('capture_busy', 'Another capture is in progress. Retry explicitly after it finishes.', 409);
      try { return respond(await reconcile(env, deps)); } finally { admission?.leave(); }
    }
    if (eventId) {
      if (admission && !admission.enter()) throw new ArchiveError('capture_busy', 'Another capture is in progress. Retry explicitly after it finishes.', 409);
      try {
        const previous=await deps.database.lookup(eventId);
        expiredRefetch=previous?await expired(deps,previous):false;
        const result = await captureEvent(eventId, env, deps, timings, checkSource);
        timings.total = performance.now() - start;
        return respond(Response.json({ ...result.capture, cache: result.cache, timings }, { status: result.cache === 'hit' ? 200 : 201 }));
      } finally { admission?.leave(); }
    }
    if (cachedMatch) {
      const capture = await deps.database.lookup(cachedMatch[1]);
      if (!capture) {
        const state = await deps.database.status(cachedMatch[1]);
        if (state === 'pending') throw new ArchiveError('capture_pending', 'Capture is in progress. Retrieve or retry explicitly after it finishes.', 409);
        if (state === 'interrupted') throw new ArchiveError('capture_interrupted', 'The previous capture did not finish. Retry explicitly; incomplete evidence is unavailable.', 409);
        throw new ArchiveError('capture_not_found', 'No captured evidence exists for this event.', 404);
      }
      if(await expired(deps,capture)) return respond(Response.json({error:{code:'artifact_expired',message:'Captured public artifacts were removed by private cleanup. Refetch explicitly; the source may no longer serve them.'},capture},{status:410}));
      for (const artifact of Object.values(capture.artifacts)) if (!await objectValid(deps.bucket, artifact)) throw new ArchiveError('artifact_unavailable', 'Captured evidence is incomplete or unavailable.', 503);
      return respond(Response.json({ ...capture, cache: 'hit', timings: { total: performance.now() - start } }));
    }
    if (artifactMatch) {
      const item = await deps.database.referencedArtifact(artifactMatch[1]);
      if (!item) throw new ArchiveError('artifact_not_found', 'No complete capture references this artifact.', 404);
      if(deps.database.artifactState && await deps.database.artifactState(item.sha256)!=='present') throw new ArchiveError('artifact_expired','The captured public artifact was removed or cleanup is pending. Refetch explicitly.',410);
      const object = await objectStoreCall(() => deps.bucket.get(`sha256/${item.sha256}`));
      if (!object || object.size !== item.bytes || !object.checksums.sha256 || hex(object.checksums.sha256) !== item.sha256) throw new ArchiveError('artifact_integrity', 'The captured artifact is unavailable or fails integrity checks.', 503);
      return respond(new Response(object.body, { headers: { 'Content-Type': item.contentType, 'Content-Length': String(item.bytes), 'X-Content-SHA256': item.sha256, 'Content-Disposition': `attachment; filename="${item.sha256}.${item.contentType.includes('xml') ? 'xml' : 'geojson'}"` } }));
    }
    throw new ArchiveError('not_found', 'Not found.', 404);
  } catch (e) {
    const error = e instanceof ArchiveError ? e : new ArchiveError('service_unavailable', 'The archive service failed. Previously saved local cases remain usable.', 503);
    return respond(Response.json({ error: { code: error.code, message: error.message }, ...(expiredRefetch?{archiveEvidence:'expired'}:{}) }, { status: error.status }));
  }
}
/** HTTP boundary with external provider/database/object-store adapters for disposable verification. */
export function createArchiveHandler(deps: ArchiveDependencies, admission?: CaptureAdmission) { return (request: Request, env: Env) => handle(request, env, async () => deps, admission); }
export default {
  fetch(request: Request, env: Env, admission?: CaptureAdmission): Promise<Response> {
    return handle(request, env, async () => {
      if (!env.DATABASE_URL || !env.ARTIFACTS || !env.REQUEST_LIMITER) throw new ArchiveError('configuration_error', 'The private archive bindings are not configured.', 503);
      return { database: createNeonDatabase(env.DATABASE_URL), bucket: env.ARTIFACTS, providerFetch: fetch, rateLimit: async kind => (await env.REQUEST_LIMITER!.limit({ key: `catlas-proof-${kind}` })).success };
    }, admission);
  },
};
