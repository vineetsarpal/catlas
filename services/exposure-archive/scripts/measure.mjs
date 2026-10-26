import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Explicit operator invocation only. No polling, automatic retry or provider calls.
const argv = process.argv.slice(2);
const outputAt = argv.indexOf('--output');
const output = outputAt >= 0 ? argv.splice(outputAt, 2)[1] : undefined;
const eventIds = argv.length ? argv : ['ci38457511'];
const token = process.env.PROOF_TOKEN;
const expectedExecutor = process.env.EXPECTED_EXECUTOR;
const base = new URL(process.env.ARCHIVE_BASE_URL ?? 'http://127.0.0.1:8787');
if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Use an archive origin without credentials, query or path.');
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use HTTPS or localhost.');
if (!token || /[\r\n]/.test(token)) throw new Error('Set PROOF_TOKEN securely in the environment; never pass it on the command line.');
if (eventIds.length > 3 || eventIds.some(id => !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new Error('Supply one to three USGS event IDs.');
if (!output) throw new Error('Supply --output with a local JSON report path.');
// Validate the report destination before causing any cloud work. Keep a record
// even when a source request fails; do not discover a bad path after acquisition.
const outputFile = resolve(output);
const destination = await open(outputFile, 'w', 0o600);
await destination.writeFile(`${JSON.stringify({ schemaVersion: 1, validation: 'measurement-started', observedAt: new Date().toISOString() })}\n`);
await destination.close();

const report = {
  schemaVersion: 1, observedAt: new Date().toISOString(), origin: base.origin,
  environment: ['localhost', '127.0.0.1'].includes(base.hostname) ? 'local-not-cloud-proof' : 'hosted-unreviewed',
  validation: 'pending', requests: [], cases: [],
  missingEvidence: [
    'Worker invocation CPU, memory profile/limit outcomes and request/subrequest metrics correlated by request ID',
    'Neon before/after compute, storage and public network usage; cold measurement after natural suspension',
    'R2 before/after bytes and class A/B operation usage, including backup headroom',
    'Idle trace showing no event work or periodic Neon queries',
    'Representative archived AND large-grid products, explicit retry/failure exercise and browser verification',
    'Vineet review of measured free-tier fit',
  ],
};
let failure = false;

async function readBounded(response, limit) {
  if (!response.body) throw new Error('Missing response body.');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body.cancel(); throw new Error('Declared response exceeds proof bound.');
  }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Response exceeds proof bound.'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, size);
}

async function request(path, { method = 'GET', body, limit = 1024 * 1024 } = {}) {
  const started = performance.now();
  const observation = { method, path, status: null, elapsedMs: null, bytes: null, requestId: null, serverTiming: null, executor: null, cfRay: null };
  report.requests.push(observation);
  let response;
  try {
    response = await fetch(new URL(path, base), { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      redirect: 'error', signal: AbortSignal.timeout(120_000), cache: 'no-store' });
    observation.status = response.status;
    observation.requestId = response.headers.get('x-request-id');
    observation.serverTiming = response.headers.get('server-timing');
    observation.executor = response.headers.get('x-catlas-executor');
    observation.cfRay = response.headers.get('cf-ray');
    const bytes = await readBounded(response, limit);
    observation.bytes = bytes.length;
    // Never persist error bodies: upstream diagnostics may include secrets.
    if (!response.ok) throw new Error(`Archive returned HTTP ${response.status}; retry explicitly after resolving the cause.`);
    if (expectedExecutor && observation.executor !== expectedExecutor) throw new Error('Unexpected execution backend.');
    return bytes;
  } finally { observation.elapsedMs = Math.round((performance.now() - started) * 100) / 100; }
}

function captureManifest(bytes) {
  const m = JSON.parse(bytes.toString('utf8'));
  if (m.schemaVersion !== 1 || !m.event?.id || !m.product?.id || !m.artifacts || !['hit', 'miss'].includes(m.cache)) throw new Error('Incompatible capture manifest.');
  for (const kind of ['detail', 'grid']) {
    const a = m.artifacts[kind], cap = kind === 'detail' ? 8 * 1024 * 1024 : 64 * 1024 * 1024;
    if (!a || !/^[a-f0-9]{64}$/.test(a.sha256) || a.path !== `/api/artifacts/${a.sha256}` || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > cap) throw new Error('Invalid or oversized artifact reference.');
  }
  return m;
}

for (const eventId of eventIds) {
  const item = { requestedEventId: eventId, outcome: 'pending' }; report.cases.push(item);
  try {
    const initial = captureManifest(await request('/api/captures', { method: 'POST', body: { eventId } }));
    item.initialCache = initial.cache;
    item.canonicalEventId = initial.event.id;
    item.productId = initial.product.id;
    item.capturedAt = initial.capturedAt;
    item.artifacts = {};
    for (const kind of ['detail', 'grid']) {
      const a = initial.artifacts[kind], bytes = await request(a.path, { limit: a.bytes });
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== a.bytes || actual !== a.sha256) throw new Error('Original-byte checksum or length mismatch.');
      item.artifacts[kind] = { bytes: bytes.length, sha256: actual, sourceUrl: a.sourceUrl };
    }
    const repeat = captureManifest(await request('/api/captures', { method: 'POST', body: { eventId } }));
    const retrieved = captureManifest(await request(`/api/captures/${encodeURIComponent(eventId)}`));
    for (const next of [repeat, retrieved]) {
      if (next.cache !== 'hit' || next.capturedAt !== initial.capturedAt || next.product.id !== initial.product.id || ['detail', 'grid'].some(kind => next.artifacts[kind].sha256 !== initial.artifacts[kind].sha256)) throw new Error('Repeated capture did not retain the same immutable evidence.');
    }
    item.outcome = 'verified-original-bytes-and-cache-reuse';
    if (initial.cache !== 'miss') item.note = 'Initial request was a hit; a separate fresh-event run is required for capture-miss measurements.';
  } catch (error) {
    item.outcome = 'failed';
    // Errors generated by this runner are safe; arbitrary transport messages are omitted.
    item.error = error instanceof Error && /^(Archive returned HTTP|Original-byte|Repeated capture|Incompatible capture|Invalid or oversized|Declared response|Response exceeds|Missing response|Unexpected execution backend)/.test(error.message) ? error.message : 'Request failed; inspect private operator diagnostics and retry explicitly.';
    failure = true;
  }
}
report.validation = failure ? 'request-check-failed' : 'request-checks-passed-hosted-fit-still-unproven';
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote ${report.cases.length} case observations to ${outputFile}. Hosted fit remains unproven until missing evidence is attached and reviewed.`);
process.exitCode = failure ? 1 : 0;
