import { providerFailure } from './provider-errors';
import { ArchiveError, type Capture, type Artifact, type ObjectBucket } from './types';
export const EVENT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const timestamp = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8.64e15) throw new ArchiveError('unsupported_evidence', 'The source returned unsupported event/product metadata.', 422);
  return new Date(value).toISOString();
};
export async function boundedBytes(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<ArrayBuffer> {
  if (!body) throw new ArchiveError('empty_response', 'The response contained no evidence bytes.');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new ArchiveError('payload_too_large', 'The response exceeds the configured byte limit.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}
export function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join(''); }
export async function hash(bytes: ArrayBuffer): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
export async function openEvidence(fetcher: typeof fetch, url: string, maximum: number, signal: AbortSignal): Promise<Response> {
  const stage = new URL(url).pathname.startsWith('/product/shakemap/') ? 'numeric grid' : 'event detail';
  let response: Response;
  try { response = await fetcher(url, { method: 'GET', signal, redirect: 'manual', headers: { accept: 'application/json, application/xml, text/xml' } }); }
  catch { throw new ArchiveError('source_unavailable', `USGS GET ${stage} transport failed. Retry explicitly.`); }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ArchiveError('source_redirect', `USGS GET ${stage} returned HTTP ${response.status}. Redirects are not followed.`, 502);
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new ArchiveError('provider_quota', 'USGS is limiting source requests. Retry explicitly later.', 503);
  }
  if (!response.ok || response.status === 204) {
    await response.body?.cancel();
    const missing = response.status === 404 || response.status === 204;
    throw new ArchiveError(missing ? stage === 'numeric grid' ? 'grid_unavailable' : 'evidence_unavailable' : 'source_unavailable', `USGS GET ${stage} returned HTTP ${response.status}. ${missing ? 'Evidence is unavailable.' : 'Retry explicitly.'}`, missing ? 422 : 502);
  }
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new ArchiveError('payload_too_large', 'The source evidence exceeds the configured byte limit.', 413); }
  return response;
}
export async function fetchEvidence(fetcher: typeof fetch, url: string, maximum: number, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await openEvidence(fetcher, url, maximum, signal);
  try { return await boundedBytes(response.body, maximum); }
  catch (error) { if (error instanceof ArchiveError) throw error; throw new ArchiveError('source_unavailable', 'The public source response was interrupted. Retry explicitly.', 502); }
}
export function selectEvidence(detailBytes: ArrayBuffer): { event: Capture['event']; product: Capture['product']; gridUrl: string; sourceGridHash?: string; sourceGridBytes?: number } {
  let detail: unknown;
  try { detail = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(detailBytes)); } catch { throw new ArchiveError('unsupported_evidence', 'The source detail is not supported JSON.', 422); }
  if (!object(detail) || typeof detail.id !== 'string' || !EVENT_ID.test(detail.id) || !object(detail.properties)) throw new ArchiveError('unsupported_evidence', 'The source event identity is unsupported.', 422);
  const properties = detail.properties;
  const aliases = typeof properties.ids === 'string' ? properties.ids.split(',').filter(id => EVENT_ID.test(id)) : [];
  if (aliases.length > 100 || (typeof properties.place === 'string' && properties.place.length > 1000)) throw new ArchiveError('unsupported_evidence', 'The source event metadata exceeds proof limits.', 422);
  const available = object(properties.products) && Array.isArray(properties.products.shakemap) ? properties.products.shakemap : [];
  if (available.length > 200) throw new ArchiveError('unsupported_evidence', 'The event contains too many source products.', 422);
  const products = available.filter((p): p is Record<string, unknown> => object(p) && p.status === 'UPDATE' && typeof p.id === 'string' && typeof p.source === 'string' && typeof p.code === 'string' && typeof p.updateTime === 'number' && Number.isFinite(p.updateTime));
  products.sort((a, b) => Number(b.preferredWeight ?? 0) - Number(a.preferredWeight ?? 0) || Number(b.updateTime) - Number(a.updateTime) || String(a.id).localeCompare(String(b.id)));
  const selected = products[0];
  if (!selected) throw new ArchiveError('evidence_unavailable', 'The event has no supported active ShakeMap. Intensity is unknown.', 422);
  if (String(selected.id).length > 512 || String(selected.source).length > 100 || String(selected.code).length > 128) throw new ArchiveError('unsupported_evidence', 'The source product identity exceeds proof limits.', 422);
  const contents = object(selected.contents) ? selected.contents : {};
  const grid = object(contents['download/grid.xml']) ? contents['download/grid.xml'] : {};
  if (!object(contents['download/grid.xml']) || typeof grid.url !== 'string' || !grid.url.trim()) throw new ArchiveError('grid_unavailable', 'The selected active ShakeMap has no numeric grid.xml. Intensity is unknown.', 422);
  let gridUrl: URL;
  try { gridUrl = new URL(String(grid.url)); } catch { throw new ArchiveError('unsupported_evidence', 'The selected ShakeMap has no supported numeric grid.', 422); }
  if (gridUrl.origin !== 'https://earthquake.usgs.gov' || gridUrl.username || gridUrl.password || gridUrl.hash || !/^\/product\/shakemap\//.test(gridUrl.pathname) || !gridUrl.pathname.endsWith('/download/grid.xml') || gridUrl.search) throw new ArchiveError('unsupported_evidence', 'The selected grid URL is outside the supported source path.', 422);
  return {
    event: { id: detail.id, aliases: [...new Set([detail.id, ...aliases])], name: typeof properties.place === 'string' ? properties.place : detail.id, occurredAt: timestamp(properties.time), updatedAt: timestamp(properties.updated) },
    product: { id: String(selected.id), source: String(selected.source), code: String(selected.code), updatedAt: timestamp(selected.updateTime), retrospective: String(selected.source).toLowerCase().includes('atlas') },
    gridUrl: gridUrl.href,
    sourceGridHash: typeof grid.sha256 === 'string' ? grid.sha256 : undefined,
    sourceGridBytes: typeof grid.length === 'number' && Number.isSafeInteger(grid.length) && grid.length > 0 ? grid.length : undefined,
  };
}

function sourceHash(value: string): string {
  if (/^[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (bytes.byteLength === 32) return hex(bytes.buffer);
  } catch { /* Unsupported source checksum is rejected below. */ }
  throw new ArchiveError('source_integrity', 'The source product checksum is unsupported.', 502);
}
function inspectGrid(prefixBytes: Uint8Array): void {
  const prefix = new TextDecoder().decode(prefixBytes);
  const mmiField = prefix.match(/<grid_field\b[^>]*\bname=["']MMI["'][^>]*>/)?.[0];
  if (mmiField && !/\bunits=["']intensity["']/.test(mmiField)) throw new ArchiveError('unsupported_units', 'The selected numeric MMI grid uses unsupported units. Intensity is unknown.', 422);
  if (!/<shakemap_grid\b/.test(prefix) || !mmiField || !/\bunits=["']intensity["']/.test(mmiField) || !/<grid_data\b/.test(prefix)) throw new ArchiveError('unsupported_layout', 'The selected grid does not declare a supported numeric MMI layout. Intensity is unknown.', 422);
}
export type PreparedGrid = { sha256: string; bytes: number; buffer?: ArrayBuffer; source?: ReadableStream<Uint8Array>; prefix?: Uint8Array[] };
/** Inspect only the bounded XML header, leaving numeric bytes in the native network stream. */
export async function prepareGrid(fetcher: typeof fetch, selected: ReturnType<typeof selectEvidence>, maximum: number, signal: AbortSignal): Promise<PreparedGrid> {
  if (!selected.sourceGridHash || !selected.sourceGridBytes) {
    // No source checksum/length: retain the bounded original-byte hashing path.
    const buffer = await fetchEvidence(fetcher, selected.gridUrl, maximum, signal);
    if (selected.sourceGridBytes && buffer.byteLength !== selected.sourceGridBytes) throw new ArchiveError('source_integrity', 'The grid size differs from the source product manifest.', 502);
    const sha256 = await hash(buffer);
    if (selected.sourceGridHash && sourceHash(selected.sourceGridHash) !== sha256) throw new ArchiveError('source_integrity', 'The grid checksum differs from the source product manifest.', 502);
    inspectGrid(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65_536)));
    return { sha256, bytes: buffer.byteLength, buffer };
  }
  const sha256 = sourceHash(selected.sourceGridHash);
  if (selected.sourceGridBytes > maximum) throw new ArchiveError('payload_too_large', 'The source evidence exceeds the configured byte limit.', 413);
  const response = await openEvidence(fetcher, selected.gridUrl, maximum, signal);
  if (!response.body) throw new ArchiveError('empty_response', 'The response contained no evidence bytes.');
  const reader = response.body.getReader(); const prefix: Uint8Array[] = [];
  const header = new Uint8Array(65_536); let headerBytes = 0; let received = 0;
  try {
    while (headerBytes < header.byteLength) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > selected.sourceGridBytes) throw new ArchiveError('source_integrity', 'The grid size exceeds the source product manifest.', 502);
      prefix.push(next.value);
      const size = Math.min(header.byteLength - headerBytes, next.value.byteLength);
      header.set(next.value.subarray(0, size), headerBytes); headerBytes += size;
      if (new TextDecoder().decode(header.subarray(0, headerBytes)).includes('<grid_data')) break;
    }
    inspectGrid(header.subarray(0, headerBytes));
    reader.releaseLock();
    return { sha256, bytes: selected.sourceGridBytes, source: response.body, prefix };
  } catch (error) {
    await reader.cancel().catch(() => {}); reader.releaseLock();
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError('source_unavailable', 'The public source grid response was interrupted. Retry explicitly.', 502);
  }
}
/** Native FixedLengthStream enforces byte count; R2 verifies SHA-256 during upload. */
export async function writePreparedGrid(bucket: ObjectBucket, grid: PreparedGrid, artifact: Artifact, signal: AbortSignal): Promise<void> {
  const options = { sha256: artifact.sha256, httpMetadata: { contentType: artifact.contentType } };
  if (grid.buffer) { await bucket.put(`sha256/${artifact.sha256}`, grid.buffer, options); return; }
  if (!grid.source || !grid.prefix) throw new ArchiveError('source_integrity', 'The grid stream is incomplete.', 502);
  const fixed = new FixedLengthStream(grid.bytes); const writer = fixed.writable.getWriter();
  const source = grid.source;
  const pump = (async () => {
    try {
      for (const chunk of grid.prefix!) { signal.throwIfAborted(); await writer.write(chunk); }
      writer.releaseLock();
      await source.pipeTo(fixed.writable, { signal });
    } catch (error) {
      try { await writer.abort(error); } catch { /* Writer may have transferred to native pipeTo. */ }
      throw new ArchiveError('source_integrity', signal.aborted ? 'The grid stream timed out before verification.' : 'The grid stream did not match its declared byte length.', 502);
    }
  })();
  const upload = bucket.put(`sha256/${artifact.sha256}`, fixed.readable, options).catch(async error => {
    await fixed.readable.cancel(error).catch(() => {});
    await source.cancel(error).catch(() => {});
    throw error;
  });
  const [pumped, uploaded] = await Promise.allSettled([pump, upload]);
  if (uploaded.status === 'rejected') { const classified = providerFailure(uploaded.reason, 'R2'); if (classified) throw classified; }
  if (pumped.status === 'rejected') throw pumped.reason;
  if (uploaded.status === 'rejected') throw new ArchiveError('artifact_integrity', 'Object storage rejected the grid bytes or source checksum. No capture was published.', 503);
}

/** Detail remains locally parsed/hashed, but crosses the R2 binding as a native stream. */
export async function writeBufferedArtifact(bucket: ObjectBucket, bytes: ArrayBuffer, artifact: Artifact, signal: AbortSignal): Promise<void> {
  const source = new Response(bytes).body!;
  const fixed = new FixedLengthStream(bytes.byteLength);
  const pump = source.pipeTo(fixed.writable, { signal });
  const upload = bucket.put(`sha256/${artifact.sha256}`, fixed.readable, { sha256: artifact.sha256, httpMetadata: { contentType: artifact.contentType } }).catch(async error => {
    await fixed.readable.cancel(error).catch(() => {});
    await source.cancel(error).catch(() => {});
    throw error;
  });
  const [pumped, uploaded] = await Promise.allSettled([pump, upload]);
  if (uploaded.status === 'rejected') { const classified = providerFailure(uploaded.reason, 'R2'); if (classified) throw classified; }
  if (pumped.status === 'rejected' || uploaded.status === 'rejected') throw new ArchiveError('object_store_unavailable', 'The public evidence object store is unavailable. Retry explicitly.', 503);
}
