import { ArchiveError, type ArchiveDependencies, type CleanupPlan } from './types';
import { boundedBytes, hex } from './provider';

type Admission = { enter(): boolean; leave(): void };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
/** Private HTTP boundary. Every mutation owns the normal fenced maintenance lease. */
export async function cleanupRequest(request: Request, deps: ArchiveDependencies, limits: { database: number; requests: number }, admission?: Admission): Promise<Response> {
  const path = new URL(request.url).pathname;
  const status = path.match(/^\/api\/maintenance\/cleanup\/([a-f0-9-]{36})$/);
  if (status && request.method === 'GET') {
    if (!uuid.test(status[1]) || !deps.database.cleanupStatus) throw new ArchiveError('cleanup_invalid', 'The cleanup plan is unavailable.', 409);
    const plan = await deps.database.cleanupStatus(status[1]);
    if (!plan) throw new ArchiveError('cleanup_invalid', 'The cleanup plan is unavailable.', 409);
    return Response.json(plan);
  }
  const preview = path === '/api/maintenance/cleanup/preview';
  const confirm = path === '/api/maintenance/cleanup/confirm';
  const retention = path === '/api/maintenance/retention';
  if (request.method !== 'POST' || !(preview || confirm || retention)) throw new ArchiveError('not_found', 'This maintenance operation does not exist.', 404);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ArchiveError('invalid_request', 'Use application/json for maintenance.', 400);
  let value: Record<string, unknown>;
  try { value = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 512))); }
  catch { throw new ArchiveError('invalid_request', 'Use a bounded maintenance request.', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArchiveError('invalid_request', 'Use the supported maintenance fields.', 400);
  const keys = Object.keys(value).sort().join(',');
  if ((preview && keys !== '') || (confirm && (keys !== 'confirmation,planId' || typeof value.planId !== 'string' || !uuid.test(value.planId) || typeof value.confirmation !== 'string' || !digest.test(value.confirmation))) ||
      (retention && (keys !== 'retain,sha256' || typeof value.sha256 !== 'string' || !digest.test(value.sha256) || typeof value.retain !== 'boolean')))
    throw new ArchiveError('invalid_request', 'Use only the supported cleanup confirmation or retention fields.', 400);
  if (!deps.database.cleanupPreview || !deps.database.cleanupConfirm || !deps.database.cleanupClaim || !deps.database.cleanupComplete || !deps.database.cleanupStatus || !deps.database.cleanupRetention)
    throw new ArchiveError('configuration_error', 'The private cleanup migration is unavailable.', 503);
  if (admission && !admission.enter()) throw new ArchiveError('capture_busy', 'Another archive operation is in progress.', 409);
  const owner = crypto.randomUUID(); let acquired = false;
  try {
    acquired = await deps.database.acquireMaintenance(owner, limits.database, limits.requests);
    if (!acquired) throw new ArchiveError('capture_busy', 'Another archive operation is in progress.', 409);
    await deps.database.recoveryGate?.(owner);
    if (preview) {
      const random = crypto.getRandomValues(new Uint8Array(32));
      return Response.json(await deps.database.cleanupPreview(owner, crypto.randomUUID(), hex(random.buffer)));
    }
    if (retention) {
      await deps.database.cleanupRetention(owner, value.sha256 as string, value.retain as boolean);
      return Response.json({ sha256: value.sha256, retained: value.retain });
    }
    const plan = await deps.database.cleanupConfirm(owner, value.planId as string, value.confirmation as string);
    if (plan.state === 'completed') return Response.json(plan);
    if (!deps.bucket.delete) throw new ArchiveError('configuration_error', 'Object deletion is unavailable.', 503);
    for (const artifact of plan.artifacts.filter(item => item.state === 'pending' || item.state === 'deleting').slice(0, 4)) {
      if (!await deps.database.cleanupClaim(owner, plan.planId, artifact.sha256)) continue;
      await boundedObject(() => deps.bucket.delete!(artifact.objectKey));
      if (await boundedObject(() => deps.bucket.head(artifact.objectKey))) throw new ArchiveError('object_store_unavailable', 'Object deletion is not confirmed. Resume the same cleanup plan explicitly.', 503);
      await deps.database.cleanupComplete(owner, plan.planId, artifact.sha256);
    }
    return Response.json(await deps.database.cleanupStatus(plan.planId));
  } finally { if (acquired) await deps.database.release(owner).catch(() => {}); admission?.leave(); }
}
async function boundedObject<T>(work: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Object deadline')), 15_000); })]); }
  catch { throw new ArchiveError('object_store_unavailable', 'Object cleanup was interrupted. Reservation remains charged; resume the same plan explicitly.', 503); }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
}
