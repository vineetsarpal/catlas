import { evidenceManifestSchema, sha256, type CapturedEvidence, type EvidenceManifest, type ShakingGrid } from './model';

export const MAX_GRID_BYTES = 64 * 1024 * 1024;
const MAX_GRID_NODES = 1_500_000;
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]] = match[3];
  return result;
}
function element(xml: string, name: string): Record<string, string> {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>`));
  if (!match) throw new Error(`ShakeMap is missing ${name}.`);
  return attributes(match[0]);
}
// Restricted numeric USGS grid reader; no entity expansion, nested documents or executable XML.
export function parseShakingGrid(xml: string): { grid: ShakingGrid; event: Record<string, string>; product: Record<string, string> } {
  if (xml.length > MAX_GRID_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported or oversized ShakeMap XML.');
  const product = element(xml, 'shakemap_grid'), event = element(xml, 'event'), spec = element(xml, 'grid_specification');
  const width = Number(spec.nlon), height = Number(spec.nlat);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > MAX_GRID_NODES)
    throw new Error('Unsupported ShakeMap grid dimensions.');
  const fields = [...xml.matchAll(/<grid_field\b[^>]*>/g)].map(match => attributes(match[0]));
  const index = (name: string, units: string[]) => {
    const field = fields.find(f => f.name === name);
    const offset = Number(field?.index) - 1;
    if (!field || !Number.isInteger(offset) || offset < 0 || offset >= fields.length || !units.includes(field.units))
      throw new Error(`Unsupported ShakeMap field or units: ${name}.`);
    return offset;
  };
  if (new Set(fields.map(f => f.index)).size !== fields.length) throw new Error('Duplicate ShakeMap field indices.');
  const lonIndex = index('LON', ['dd']), latIndex = index('LAT', ['dd']), mmiIndex = index('MMI', ['intensity', 'mmi']);
  const data = xml.match(/<grid_data\b[^>]*>([\s\S]*?)<\/grid_data\s*>/);
  if (!data) throw new Error('ShakeMap has no numeric grid.');
  const lines = data[1].trim().split(/\r?\n/);
  if (lines.length !== width * height) throw new Error('ShakeMap row count does not match its dimensions.');
  const longitudes: number[] = [], northToSouth: number[] = [], values: (number | null)[] = new Array(lines.length);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const fieldsAtNode = lines[row * width + column].trim().split(/\s+/);
    if (fieldsAtNode.length !== fields.length) throw new Error('ShakeMap grid has an incomplete numeric row.');
    const longitude = Number(fieldsAtNode[lonIndex]), latitude = Number(fieldsAtNode[latIndex]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90)
      throw new Error('Invalid ShakeMap node coordinates.');
    if (row === 0) longitudes.push(longitude);
    if (column === 0) northToSouth.push(latitude);
    if (longitude !== longitudes[column] || latitude !== northToSouth[row]) throw new Error('ShakeMap is not a supported rectangular grid.');
    const mmi = Number(fieldsAtNode[mmiIndex]);
    values[(height - 1 - row) * width + column] = Number.isFinite(mmi) && mmi >= 1 && mmi <= 12 ? mmi : null;
  }
  if (longitudes.some((v, i) => i > 0 && v <= longitudes[i - 1]) || northToSouth.some((v, i) => i > 0 && v >= northToSouth[i - 1]))
    throw new Error('Unsupported ShakeMap coordinate ordering.');
  return { grid: { longitudes, latitudes: northToSouth.reverse(), values }, event, product };
}

export async function captureEvidence(rawXml: string, metadata: Omit<EvidenceManifest, 'rawSha256' | 'measure' | 'units' | 'processedAt' | 'productVersion' | 'eventDetailUrl' | 'eventDetailSha256'>, expectedHash?: string, detail?: { url: string; text: string }): Promise<CapturedEvidence> {
  const rawSha256 = await sha256(rawXml);
  if (expectedHash && expectedHash !== rawSha256) throw new Error('Captured ShakeMap SHA-256 does not match the expected evidence.');
  const { grid, event, product } = parseShakingGrid(rawXml);
  const aliases = new Set([metadata.eventId, ...metadata.aliases]);
  if (!aliases.has(event.event_id) || !aliases.has(product.event_id)) throw new Error('ShakeMap event identity does not match the selected earthquake.');
  const manifest = evidenceManifestSchema.parse({ ...metadata, rawSha256, measure: 'MMI', units: 'intensity',
    processedAt: product.process_timestamp, productVersion: product.shakemap_version,
    eventDetailUrl: detail?.url ?? null, eventDetailSha256: detail ? await sha256(detail.text) : null });
  return { manifest, rawXml, rawEventJson: detail?.text ?? null, grid };
}

export async function readBoundedStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error(`File exceeds the ${Math.round(limit / 1024 / 1024)} MB supported limit.`); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
export async function readTextResponse(response: Response, limit = MAX_GRID_BYTES): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`Evidence request failed (${response.status}).`);
  return new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedStream(response.body, limit));
}
export async function loadReplay(signal?: AbortSignal): Promise<CapturedEvidence> {
  const response = await fetch('./evidence/shaking/ridgecrest-grid.xml.gz', { signal });
  if (!response.ok || !response.body) throw new Error('Packaged earthquake evidence could not be loaded.');
  // Some static hosts advertise .gz assets with Content-Encoding: gzip, so fetch
  // has already decoded them. Other hosts serve the literal gzip bytes.
  const received = await readBoundedStream(response.body, MAX_GRID_BYTES);
  const bytes = received[0] === 0x1f && received[1] === 0x8b
    ? await readBoundedStream(new Blob([received]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_GRID_BYTES)
    : received;
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const eventDetail = await readTextResponse(await fetch('./evidence/ridgecrest-detail.geojson', { signal }), 8 * 1024 * 1024);
  return captureEvidence(raw, {
    eventId: 'ci38457511', aliases: ['us70004bn0'], eventName: 'Ridgecrest, California', magnitude: 7.1,
    longitude: -117.5993, latitude: 35.7695, occurredAt: '2019-07-06T03:19:53.000Z',
    productId: 'urn:usgs-product:atlas:shakemap:ci38457511:1594160054783', provider: 'atlas',
    productUpdatedAt: new Date(1594160054783).toISOString(), capturedAt: new Date().toISOString(), retrospective: true,
    sourceUrl: 'https://earthquake.usgs.gov/product/shakemap/ci38457511/atlas/1594160054783/download/grid.xml',
  }, 'f4fbcf36e9098963ddc2ea82656974c268b50df5dfdb49b9bf9ffae72ea8e306', { url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/ci38457511.geojson', text: eventDetail });
}
