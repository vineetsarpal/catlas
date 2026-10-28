import { routeRequest, type FrontDoorEnv } from './router';

export type BackupScheduleEnv = FrontDoorEnv & { ADMIN_TOKEN?: string; PROOF_TOKEN?: string };
export type BackupScheduleTransport = (request: Request) => Promise<Response>;
const jobId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Daily maintenance entrypoint: private backup requests only; never discovers or captures events. */
export async function runDailyBackup(env: BackupScheduleEnv, transport: BackupScheduleTransport = request => routeRequest(request, env)): Promise<void> {
  const credential = env.ADMIN_TOKEN;
  if (!credential || credential.length < 24 || credential === env.PROOF_TOKEN)
    throw new Error('Daily backup administrative credential is unavailable. Inspect private configuration.');
  const deadline = Date.now() + 240_000;
  async function post(action: 'start' | 'advance' | 'rotate', body: Record<string, unknown>): Promise<unknown> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Daily backup remains incomplete at its maintenance deadline. Inspect the private inventory.');
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const request = new Request(`https://catlas.internal/api/maintenance/backups/${action}`, {
        method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      const operation = (async () => {
      const response = await transport(request);
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Daily backup request refused with HTTP ${response.status}. Inspect private inventory.`); }
      if (!response.body) throw new Error('Daily backup response is incomplete. Inspect private inventory.');
      reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      try {
        while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1_048_576) { await reader.cancel(); throw new Error('Daily backup response exceeds its bound. Inspect private inventory.'); } chunks.push(next.value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
      catch { throw new Error('Daily backup response is incompatible. Inspect private inventory.'); }
      })();
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => {});
          reject(new Error('Daily backup request timed out. Inspect private inventory before resuming.'));
        }, Math.min(60_000, remaining));
      })]);
    } finally { if (timeout !== undefined) clearTimeout(timeout); controller.abort(); }
  }
  function job(value: unknown): { id: string; state: 'building' | 'complete' | 'failed' } {
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !jobId.test(value.id) || !('state' in value) || !['building', 'complete', 'failed'].includes(String(value.state)))
      throw new Error('Daily backup status is incompatible. Inspect private inventory.');
    return value as { id: string; state: 'building' | 'complete' | 'failed' };
  }
  let current = job(await post('start', {}));
  for (let batch = 0; current.state === 'building' && batch < 16; batch++) {
    const next = job(await post('advance', { id: current.id }));
    if (next.id !== current.id) throw new Error('Daily backup identity changed. Inspect private inventory.');
    current = next;
  }
  if (current.state === 'failed') throw new Error('Daily backup failed. Inspect private inventory; no recovery point is claimed complete.');
  if (current.state !== 'complete') throw new Error('Daily backup remains incomplete after its bounded maintenance run. Resume it through private maintenance.');
  await post('rotate', {});
}
