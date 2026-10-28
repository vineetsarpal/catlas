import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

const usage = `Private archive cleanup (Node 24+)
  cleanup.mjs preview --output <new-plan.json>
  cleanup.mjs confirm --plan <plan.json> --output <new-receipt.json> [--confirm <plan-confirmation>]
  cleanup.mjs status --plan <plan.json> --output <new-status.json>
  cleanup.mjs retention --sha256 <hash> --retain true|false --output <new-receipt.json> [--confirm <hash>]
Set ARCHIVE_BASE_URL and ADMIN_TOKEN securely in the operator environment.
Production origins must use HTTPS *.workers.dev. --allow-local permits a disposable HTTP loopback fixture.
Preview never deletes; confirmation is explicit. Existing output files are never overwritten.`;
class OperatorError extends Error {}
const refuse = message => { throw new OperatorError(message); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const confirmationValue = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(value);

async function boundedJson(response) {
  if (!response.body) refuse('The archive response is missing.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 131072) { await reader.cancel(); refuse('The archive response exceeded its byte limit.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { refuse('The archive response is not compatible JSON.'); }
}
function validatePlan(plan) {
  if (!plan || !uuid(plan.planId) || !confirmationValue(plan.confirmation) || !Number.isFinite(Date.parse(plan.expiresAt)) ||
      !Array.isArray(plan.artifacts) || plan.artifacts.length > 16 || !Array.isArray(plan.logs) || plan.logs.length > 16 ||
      plan.artifacts.some(item => !digest(item?.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) ||
      plan.logs.some(item => !item || typeof item.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.eventId)))
    refuse('The archive returned an incompatible cleanup plan.');
  return plan;
}
async function readPlan(path, origin) {
  const raw = await readFile(resolve(path));
  if (raw.byteLength > 131072) refuse('The saved plan exceeds its byte limit.');
  let saved; try { saved = JSON.parse(raw.toString('utf8')); } catch { refuse('The saved plan is not compatible JSON.'); }
  if (saved?.format !== 'catlas-archive-cleanup-plan' || saved.schemaVersion !== 1 || saved.origin !== origin)
    refuse('The saved plan does not match this archive origin.');
  return validatePlan(saved.plan);
}
async function explicitConfirmation(supplied, expected, description) {
  if (supplied !== undefined) {
    if (supplied !== expected) refuse('The explicit confirmation does not match the selected plan or artifact.');
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) refuse('Explicit confirmation is required; inspect the saved plan and supply --confirm.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`${description}\nType ${expected} to confirm: `);
    if (answer !== expected) refuse('Confirmation declined; no deletion request was sent.');
  } finally { terminal.close(); }
}

let outputHandle;
async function persist(value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  await outputHandle.truncate(0);
  await outputHandle.write(bytes, 0, bytes.length, 0);
  await outputHandle.sync();
}
try {
  let parsed;
  try { parsed = parseArgs({ options: { output: { type: 'string' }, plan: { type: 'string' }, confirm: { type: 'string' }, sha256: { type: 'string' }, retain: { type: 'string' }, 'allow-local': { type: 'boolean', default: false }, help: { type: 'boolean' } }, allowPositionals: true, strict: true }); }
  catch { refuse(usage); }
  const options = parsed.values, [action] = parsed.positionals;
  if (options.help) { console.log(usage); process.exit(0); }
  if (parsed.positionals.length !== 1 || !['preview', 'confirm', 'status', 'retention'].includes(action) || !options.output) refuse(usage);
  const allowed = { preview: ['output', 'allow-local'], confirm: ['output', 'plan', 'confirm', 'allow-local'], status: ['output', 'plan', 'allow-local'], retention: ['output', 'sha256', 'retain', 'confirm', 'allow-local'] }[action];
  if (Object.keys(options).some(key => !allowed.includes(key))) refuse('An option does not apply to this action.');
  let origin;
  try { origin = new URL(process.env.ARCHIVE_BASE_URL ?? ''); } catch { refuse('Set ARCHIVE_BASE_URL to the private archive origin.'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') refuse('Use an archive origin without credentials, query or path.');
  const hosted = origin.protocol === 'https:' && origin.hostname.endsWith('.workers.dev') && !origin.port;
  const local = options['allow-local'] && origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (!hosted && !local) refuse('Use an HTTPS workers.dev origin, or explicitly permit a disposable loopback fixture with --allow-local.');
  const token = process.env.ADMIN_TOKEN;
  if (typeof token !== 'string' || token.length < 24 || token.length > 512 || /[\r\n]/.test(token)) refuse('Set ADMIN_TOKEN securely in the environment. The public proof token is not used.');
  let plan;
  if (action === 'confirm' || action === 'status') {
    if (!options.plan) refuse('Select a saved preview with --plan.');
    plan = await readPlan(options.plan, origin.origin);
  }
  if (action === 'confirm') await explicitConfirmation(options.confirm, plan.confirmation, `Confirm only the reviewed bounded cleanup plan ${plan.planId}.`);
  if (action === 'retention') {
    if (!digest(options.sha256) || !['true', 'false'].includes(options.retain)) refuse('Retention requires --sha256 and --retain true|false.');
    if (options.retain === 'false') await explicitConfirmation(options.confirm, options.sha256, 'Remove this artifact retention override. A later separately confirmed cleanup may delete it.');
    else if (options.confirm !== undefined) refuse('--confirm applies only when removing a retention override.');
  }
  // Exclusively create the receipt before causing any server work. No existing file or symlink is followed.
  outputHandle = await open(resolve(options.output), 'wx', 0o600);
  const observedAt = new Date().toISOString();
  await persist({ schemaVersion: 1, action, origin: origin.origin, observedAt, status: 'request-started' });
  const path = action === 'preview' ? '/api/maintenance/cleanup/preview' : action === 'confirm' ? '/api/maintenance/cleanup/confirm' : action === 'status' ? `/api/maintenance/cleanup/${plan.planId}` : '/api/maintenance/retention';
  const body = action === 'preview' ? {} : action === 'confirm' ? { planId: plan.planId, confirmation: plan.confirmation } : action === 'retention' ? { sha256: options.sha256, retain: options.retain === 'true' } : undefined;
  const response = await fetch(new URL(path, origin), { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000), redirect: 'error', cache: 'no-store' });
  if (!response.ok) {
    await response.body?.cancel();
    await persist({ schemaVersion: 1, action, origin: origin.origin, observedAt, status: 'request-refused', httpStatus: response.status });
    refuse(`Archive returned HTTP ${response.status}. No automatic retry was attempted; inspect private operator diagnostics.`);
  }
  const result = await boundedJson(response);
  if (action === 'preview') {
    validatePlan(result);
    await persist({ format: 'catlas-archive-cleanup-plan', schemaVersion: 1, origin: origin.origin, observedAt, plan: result });
    console.log(`Preview saved: ${result.artifacts.length} artifacts, ${result.logs.length} routine logs. No deletion requested. Inspect ${resolve(options.output)} before confirming.`);
  } else {
    await persist({ format: 'catlas-archive-cleanup-receipt', schemaVersion: 1, origin: origin.origin, observedAt, action, result });
    console.log(`Private ${action} response saved to ${resolve(options.output)}. No automatic follow-up was scheduled.`);
  }
} catch (error) {
  console.error(error instanceof OperatorError ? error.message : 'Private cleanup command failed. Inspect local permissions, configuration or private operator diagnostics; no automatic retry was attempted.');
  process.exitCode = 1;
} finally { await outputHandle?.close(); }
