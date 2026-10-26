export type ArchiveBridgeEnv = { ARCHIVE_API_ORIGIN?: string; ARCHIVE_PROOF_TOKEN?: string };
const responseHeaders = (headers: Headers) => {
  const safe = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const key of ['content-type', 'content-length', 'content-disposition', 'x-content-sha256', 'x-request-id']) {
    const value = headers.get(key); if (value) safe.set(key, value);
  }
  return safe;
};
const refuse = (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function archiveBridge(request: Request, env: ArchiveBridgeEnv, upstream: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/api/exposure/'.length);
  const catalog = path === 'catalog' && request.method === 'GET';
  const capture = path === 'captures' && request.method === 'POST';
  const saved = /^captures\/[a-zA-Z0-9_-]{1,100}$/.test(path) && request.method === 'GET';
  const artifact = /^artifacts\/[a-f0-9]{64}$/.test(path) && request.method === 'GET';
  if (!url.pathname.startsWith('/api/exposure/') || !(catalog || capture || saved || artifact)) return refuse('not_found', 'This public archive route does not exist.', 404);
  if (catalog) {
    const keys = [...url.searchParams.keys()];
    const offset = url.searchParams.get('offset');
    const end = url.searchParams.get('end');
    const validTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/(?<=:\d{2})Z$/, '.000Z');
    if (end !== null && !validTime(end)) return refuse('invalid_request', 'Use a valid UTC discovery window.', 400);
    const allowed = ['significant', 'offset', 'end', 'mode', 'start', 'minMagnitude', 'maxMagnitude', 'minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude', 'eventId'];
    if (keys.some(key => !allowed.includes(key)) || new Set(keys).size !== keys.length || (url.searchParams.has('significant') && !['true', 'false'].includes(url.searchParams.get('significant')!)) || (offset !== null && (!/^\d+$/.test(offset) || Number(offset) > 450 || Number(offset) % 50 !== 0))) return refuse('invalid_request', 'Use only the supported discovery filters.', 400);
    const params = url.searchParams;
    const historical = params.get('mode') === 'historical';
    const searchFields = ['start', 'minMagnitude', 'maxMagnitude', 'minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude', 'eventId'];
    if ((params.has('mode') && !['recent', 'historical'].includes(params.get('mode')!)) || (!historical && searchFields.some(key => params.has(key)))) return refuse('invalid_request', 'Use historical mode for historical search.', 400);
    if (historical) {
      if (params.has('eventId')) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(params.get('eventId')!) || keys.some(key => !['mode', 'eventId', 'offset'].includes(key)) || Number(offset ?? 0) !== 0) return refuse('invalid_request', 'Source-ID lookup accepts only an event ID.', 400);
      } else {
        const start = params.get('start');
        if (!start || !end || !validTime(start) || Date.parse(start) > Date.parse(end)) return refuse('invalid_request', 'Use a valid UTC historical date range.', 400);
        const numbers = ['minMagnitude', 'maxMagnitude', 'minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude'];
        for (const key of numbers) {
          const raw = params.get(key);
          if (raw !== null && (raw.length > 32 || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)))) return refuse('invalid_request', 'Use finite public search bounds.', 400);
        }
        if (params.has('minMagnitude') && params.has('maxMagnitude') && Number(params.get('minMagnitude')) > Number(params.get('maxMagnitude'))) return refuse('invalid_request', 'Minimum magnitude must not exceed maximum.', 400);
        const area = ['minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude'];
        if (area.some(key => params.has(key))) {
          const [south, north, west, east] = area.map(key => Number(params.get(key)));
          if (!area.every(key => params.has(key)) || south < -90 || north > 90 || south >= north || west < -360 || east > 360 || west >= east || east - west > 360) return refuse('invalid_request', 'Use a complete valid geographic bounding box.', 400);
        }
      }
    }
  } else if (url.search) return refuse('invalid_request', 'This route does not accept query parameters.', 400);
  let body: string | undefined;
  if (capture) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return refuse('invalid_request', 'Use application/json for capture requests.', 400);
    const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (!reader) return refuse('invalid_request', 'Send only a valid USGS eventId.', 400);
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > 256) { await reader.cancel(); return refuse('payload_too_large', 'The capture payload exceeds its byte limit.', 413); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { value = null; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('eventId' in value) || typeof value.eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.eventId)) return refuse('invalid_request', 'Send only a valid USGS eventId.', 400);
    body = JSON.stringify({ eventId: value.eventId });
  }
  let origin: URL;
  try { origin = new URL(env.ARCHIVE_API_ORIGIN ?? ''); } catch { return refuse('archive_configuration', 'The archive connection is not configured. Saved local cases remain usable.', 503); }
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.workers.dev') || origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !env.ARCHIVE_PROOF_TOKEN || env.ARCHIVE_PROOF_TOKEN.length < 24) return refuse('archive_configuration', 'The archive connection is not configured. Saved local cases remain usable.', 503);
  const target = `${origin.origin}/api/${url.pathname.slice('/api/exposure/'.length)}${url.search}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  try {
    const result = await upstream(target, { method: request.method, headers: { authorization: `Bearer ${env.ARCHIVE_PROOF_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body, redirect: 'manual', signal });
    if (!result.ok) {
      if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); return refuse('archive_unavailable', 'The public archive is unavailable. Retry explicitly.', 503); }
      const messages: Record<string, string> = {
        capacity_exceeded: 'The archive storage budget is full. Saved evidence remains available.',
        usage_limit: 'The archive daily acquisition allowance was reached. Saved evidence remains available.',
        rate_limited: 'The archive request limit was reached. Retry explicitly later.',
        provider_quota: 'A provider allowance or request limit was reached. Retry explicitly later.',
        provider_suspended: 'An archive provider is disabled or suspended. Contact the operator.',
        capture_busy: 'Another capture is in progress. Retry explicitly after it finishes.',
        capture_pending: 'Capture is in progress. Retrieve or retry explicitly after it finishes.',
        capture_interrupted: 'The previous capture did not finish. Retry explicitly.',
        capture_uncertain: 'Publication could not be confirmed. Retrieve or retry explicitly.',
        capture_not_found: 'No saved public capture exists for this event.',
        artifact_not_found: 'No complete capture references this artifact.',
        artifact_unavailable: 'The captured artifact is unavailable. No replacement was selected.',
        artifact_integrity: 'The captured artifact failed verification. No replacement was selected.',
        evidence_unavailable: 'No supported shaking evidence is available. Intensity remains unknown.',
        grid_unavailable: 'The selected ShakeMap has no available numeric grid. Intensity remains unknown.',
        unsupported_layout: 'The numeric grid layout is unsupported. Intensity remains unknown.',
        unsupported_units: 'The numeric grid uses unsupported intensity units. Intensity remains unknown.',
        unsupported_evidence: 'The source evidence is unsupported. Intensity remains unknown.',
        database_unavailable: 'The public metadata database (Neon) is unavailable. Retry explicitly; saved local cases remain usable.',
        object_store_unavailable: 'The public evidence object store (R2) is unavailable. Retry explicitly; saved local cases remain usable.',
        service_unavailable: 'The archive API service is unavailable. Retry explicitly; saved local cases remain usable.',
        source_unavailable: 'The public source is unavailable. Retry explicitly.',
        source_redirect: 'The public source returned an unsupported redirect.',
        source_integrity: 'The public source evidence failed verification.',
        payload_too_large: 'The evidence exceeds the supported byte limit.',
        invalid_request: 'The archive request is invalid.',
        identity_conflict: 'Source identity conflicts with retained evidence. No replacement was selected.',
      };
      let payload: unknown;
      const reader = result.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        try {
          while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 8192) { await reader.cancel(); break; } chunks.push(item.value); }
          if (size <= 8192) { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } payload = JSON.parse(new TextDecoder().decode(bytes)); }
        } catch { /* Never relay an upstream body or parse diagnostic. */ } finally { reader.releaseLock(); }
      }
      const code = payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'code' in payload.error && typeof payload.error.code === 'string' ? payload.error.code : '';
      return code && Object.hasOwn(messages, code) ? refuse(code, messages[code], result.status) : refuse('archive_unavailable', 'The public archive is unavailable. Retry explicitly.', 503);
    }
    return new Response(result.body, { status: result.status, headers: responseHeaders(result.headers) });
  } catch { return refuse('archive_unavailable', 'The public archive is unavailable. Retry explicitly.', 503); }
  finally { clearTimeout(timeout); }
}
