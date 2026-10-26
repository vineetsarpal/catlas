const form = document.querySelector('#capture-form');
const eventInput = document.querySelector('#event-id');
const tokenInput = document.querySelector('#proof-token');
const captureButton = document.querySelector('#capture-button');
const retrieveButton = document.querySelector('#retrieve-button');
const retryButton = document.querySelector('#retry-button');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const result = document.querySelector('#capture-result');
const artifacts = document.querySelector('#artifacts');
const objectUrls = new Set();
const limits = { detail: 8 * 1024 * 1024, grid: 64 * 1024 * 1024, manifest: 1024 * 1024 };
let busy = false;
let lastAction = 'capture';

function resetDownloads() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  artifacts.replaceChildren();
}

async function boundedBytes(response, limit) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new Error('The response exceeds this proof’s download limit.');
  }
  if (!response.body) throw new Error('The archive returned an empty response body.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('The response exceeds this proof’s download limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function request(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    let code = `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(new TextDecoder().decode(await boundedBytes(response, limits.manifest)));
      if (typeof payload.error?.code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(payload.error.code)) code = payload.error.code;
      // Error text from a service may contain configuration details. Show its code,
      // not raw backend diagnostics or the submitted token.
    } catch { /* A bounded generic error remains useful for non-JSON failures. */ }
    const captureMessages = {
      capture_pending: 'This capture is still in progress. No complete evidence is available yet. Retry explicitly after it finishes.',
      capture_interrupted: 'This capture was interrupted. No complete evidence is available yet. Retry explicitly to try again.',
    };
    if ([502, 503].includes(response.status) && code === 'provider_suspended') throw new Error('A service provider has suspended access. The archive cannot complete this request. Try saved evidence where services remain available, or retry explicitly after access is restored.');
    if ([502, 503].includes(response.status) && code === 'provider_quota') throw new Error('A service provider has reached its quota. This is separate from the archive’s storage budget. Try saved evidence where services remain available, or retry explicitly later.');
    if (response.status === 429 && code === 'usage_limit') throw new Error('The archive capture usage budget is exhausted. New captures are paused. You can still try retrieving saved evidence.');
    if (response.status === 507 && code === 'capacity_exceeded') throw new Error('The archive storage budget is full. New captures are paused. You can still try retrieving saved evidence.');
    throw new Error((response.status === 409 && Object.hasOwn(captureMessages, code) && captureMessages[code]) || `Archive request failed (${code}). You can retry explicitly.`);
  }
  return response;
}

function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validateManifest(manifest) {
  const invalid = () => { throw new Error('The archive returned an incompatible capture manifest.'); };
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.event || !manifest.product || !manifest.artifacts) invalid();
  if (typeof manifest.event.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(manifest.event.id)
    || typeof manifest.event.name !== 'string' || !Array.isArray(manifest.event.aliases)
    || !manifest.event.aliases.every(alias => typeof alias === 'string')
    || !validDate(manifest.event.occurredAt) || !validDate(manifest.event.updatedAt)
    || !validDate(manifest.capturedAt) || !validDate(manifest.product.updatedAt)
    || !['id', 'source', 'code'].every(key => typeof manifest.product[key] === 'string')
    || typeof manifest.product.retrospective !== 'boolean' || !['hit', 'miss'].includes(manifest.cache)) invalid();
  for (const name of ['detail', 'grid']) {
    const artifact = manifest.artifacts[name];
    if (!artifact || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > limits[name]
      || artifact.path !== `/api/artifacts/${artifact.sha256}` || typeof artifact.contentType !== 'string') invalid();
    let url;
    try { url = new URL(artifact.sourceUrl); } catch { invalid(); }
    if (url.origin !== 'https://earthquake.usgs.gov' || url.username || url.password) invalid();
  }
  return manifest;
}

function appendDefinition(container, term, value) {
  const dt = document.createElement('dt'); dt.textContent = term;
  const dd = document.createElement('dd'); dd.textContent = value;
  container.append(dt, dd);
}

function artifactCard(name, artifact) {
  const card = document.createElement('article'); card.className = 'artifact';
  const title = document.createElement('h4'); title.textContent = name === 'detail' ? 'Source event detail' : 'ShakeMap numeric grid';
  const size = document.createElement('p'); size.textContent = `${artifact.bytes.toLocaleString()} original bytes`;
  const digest = document.createElement('p');
  const digestLabel = document.createElement('span'); digestLabel.textContent = 'SHA-256: ';
  const hash = document.createElement('code'); hash.textContent = artifact.sha256;
  digest.append(digestLabel, hash);
  const source = document.createElement('a'); source.textContent = artifact.sourceUrl;
  source.href = artifact.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer';
  const sourceLine = document.createElement('p'); sourceLine.append(source);
  const verification = document.createElement('p'); verification.className = 'verification'; verification.textContent = 'Awaiting byte verification.';
  card.append(title, size, digest, sourceLine, verification); artifacts.append(card);
  return { card, verification };
}

function showManifest(manifest) {
  document.querySelector('#event-heading').textContent = manifest.event.name;
  document.querySelector('#event-source').textContent = `USGS / ${manifest.event.id}`;
  document.querySelector('#cache-state').textContent = manifest.cache === 'hit' ? 'Captured evidence reused' : 'New evidence captured';
  const provenance = document.querySelector('#provenance'); provenance.replaceChildren();
  for (const [label, value] of [
    ['Occurrence time', manifest.event.occurredAt], ['Event updated', manifest.event.updatedAt],
    ['Product updated', manifest.product.updatedAt], ['Catlas captured', manifest.capturedAt],
    ['Product identity', manifest.product.id], ['Product source / code', `${manifest.product.source} / ${manifest.product.code}`],
    ['Event aliases', manifest.event.aliases.join(', ') || 'None supplied'],
  ]) appendDefinition(provenance, label, value);
  document.querySelector('#retrospective').textContent = manifest.product.retrospective
    ? 'This is retrospective evidence. It does not reconstruct what was known at the earthquake’s occurrence.'
    : 'This is the selected captured product. Its update and capture times do not establish what was known at occurrence.';
  result.hidden = false;
}

async function verifyArtifact(name, artifact, token) {
  const { card, verification } = artifactCard(name, artifact);
  verification.textContent = 'Retrieving original bytes…';
  try {
    const response = await request(`/api/artifacts/${artifact.sha256}`, token);
    const bytes = await boundedBytes(response, artifact.bytes);
    if (bytes.byteLength !== artifact.bytes) throw new Error('Original byte length does not match the captured manifest.');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== artifact.sha256) throw new Error('SHA-256 does not match the captured manifest. Download refused.');
    verification.textContent = 'Verified original bytes · SHA-256 and length match';
    verification.classList.add('verified');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); objectUrls.add(url);
    const download = document.createElement('a'); download.href = url; download.className = 'download';
    download.download = `${name}-${artifact.sha256}.${name === 'detail' ? 'geojson' : 'xml'}`;
    download.textContent = name === 'detail' ? 'Download verified event detail' : 'Download verified grid';
    card.append(download);
    return bytes.byteLength;
  } catch (failure) {
    verification.textContent = failure instanceof Error ? failure.message : 'Byte verification failed. Download refused.';
    verification.classList.add('failed');
    throw failure;
  }
}

async function run(action) {
  if (busy || !form.reportValidity()) return;
  const eventId = eventInput.value.trim();
  const token = tokenInput.value;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(eventId)) return;
  if (!crypto.subtle) { error.hidden = false; error.textContent = 'Byte verification requires HTTPS or localhost.'; return; }
  busy = true; lastAction = action;
  for (const button of [captureButton, retrieveButton, retryButton]) button.disabled = true;
  retryButton.hidden = true; error.hidden = true; error.textContent = ''; result.hidden = true;
  resetDownloads();
  status.textContent = action === 'capture' ? 'Requesting capture or reuse…' : 'Retrieving saved capture…';
  const started = performance.now();
  try {
    const response = await request(action === 'capture' ? '/api/captures' : `/api/captures/${encodeURIComponent(eventId)}`, token,
      action === 'capture' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId }) } : {});
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(await boundedBytes(response, limits.manifest))));
    showManifest(manifest);
    status.textContent = 'Capture retrieved. Verifying both original artifacts in this browser…';
    let verifiedBytes = 0;
    for (const name of ['detail', 'grid']) verifiedBytes += await verifyArtifact(name, manifest.artifacts[name], token);
    const measurements = document.querySelector('#measurements'); measurements.replaceChildren();
    appendDefinition(measurements, 'Browser elapsed', `${(performance.now() - started).toFixed(0)} ms`);
    appendDefinition(measurements, 'Verified bytes retrieved', verifiedBytes.toLocaleString());
    const requestId = response.headers.get('x-request-id');
    if (requestId) appendDefinition(measurements, 'Request ID', requestId);
    for (const [name, ms] of Object.entries(manifest.timings ?? {})) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) appendDefinition(measurements, `${name} (server)`, `${ms.toFixed(1)} ms`);
    }
    status.textContent = 'Both original artifacts verified in this browser. Downloads are ready.';
  } catch (failure) {
    // Never interpolate the token or raw response body into the page.
    error.textContent = failure instanceof Error ? failure.message : 'The request failed. Retry explicitly.';
    error.hidden = false; retryButton.hidden = false;
    status.textContent = 'Request or byte verification failed. No exposure assessment was created.';
  } finally {
    busy = false;
    for (const button of [captureButton, retrieveButton, retryButton]) button.disabled = false;
  }
}

form.addEventListener('submit', event => { event.preventDefault(); void run('capture'); });
retrieveButton.addEventListener('click', () => { void run('retrieve'); });
retryButton.addEventListener('click', () => { void run(lastAction); });
window.addEventListener('pagehide', resetDownloads);
