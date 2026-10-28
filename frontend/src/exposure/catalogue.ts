import { z } from 'zod';
import { earthquakeSchema, type Earthquake } from './model';
import { captureEvidence, readBoundedStream } from './evidence';
import type { EarthquakeCapture } from './capture';

const eventId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const catalogEventSchema = earthquakeSchema.extend({ aliases: z.array(eventId).max(5050), significance: z.number().finite().nullable() });
export type CatalogEvent = z.infer<typeof catalogEventSchema>;
const catalogPageSchema = z.object({
  events: z.array(catalogEventSchema).max(50), checkedAt: z.string().datetime(),
  range: z.object({ start: z.string().datetime(), end: z.string().datetime() }),
  offset: z.number().int().nonnegative().max(450).refine(value => value % 50 === 0), limit: z.literal(50), hasMore: z.boolean(),
  completeness: z.enum(['complete', 'more-available', 'partial']), rejected: z.number().int().nonnegative(),
});
export type CatalogPage = z.infer<typeof catalogPageSchema>;

const messages: Record<string, string> = {
  cleanup_conflict: 'Public archive cleanup is in progress. Retry evidence retrieval after the operator completes it; saved local investigations remain usable.',
  artifact_expired: 'Public evidence was removed by private archive cleanup. Retry evidence retrieval explicitly; the source may no longer provide it. Saved local investigations remain usable.',
  artifact_unavailable: 'Captured artifact unavailable in archive object storage. Retained evidence and saved cases are unchanged.',
  artifact_not_found: 'Captured artifact not found in archive object storage. Retained evidence and saved cases are unchanged.',
  artifact_integrity: 'Stored artifact failed SHA-256 integrity verification. No replacement evidence was selected.',
  capture_not_found: 'No saved public capture exists for this event. Retry evidence retrieval explicitly.',
  source_redirect: 'Public earthquake source unavailable because it returned an unsupported redirect. Retry explicitly.',
  grid_unavailable: 'No usable numeric grid is available for the selected ShakeMap. Location intensity remains unknown.',
  unsupported_layout: 'Unsupported ShakeMap layout. Location intensity remains unknown.',
  unsupported_units: 'Unsupported ShakeMap units. Location intensity remains unknown.',
  evidence_integrity: 'Original evidence SHA-256 or byte length does not match its captured reference. No assessment was created.',
  source_integrity: 'Captured source detail failed integrity or format checks. No assessment was created.',
  identity_conflict: 'Captured event identity conflicts with the selected earthquake. No replacement evidence was selected.',
  source_unavailable: 'Public earthquake source unavailable. Retry explicitly; retained evidence and saved cases are unchanged.',
  database_unavailable: 'Archive database unavailable. Retry explicitly; retained evidence and saved cases are unchanged.',
  object_store_unavailable: 'Archive object storage unavailable. Retry explicitly; retained evidence and saved cases are unchanged.',
  archive_unavailable: 'Archive API unavailable. Retry explicitly; retained evidence and saved cases are unchanged.',
  service_unavailable: 'Archive service unavailable. Retry explicitly; retained evidence and saved cases are unchanged.',
  archive_configuration: 'The archive connection is not configured. Existing local cases remain usable.',
  evidence_unavailable: 'No supported shaking evidence is available. Location intensity remains unknown.',
  unsupported_evidence: 'The captured shaking evidence is unsupported. Location intensity remains unknown.',
  capacity_exceeded: 'The archive storage budget is full. Saved investigations remain usable.',
  usage_limit: 'The archive daily acquisition allowance is exhausted. Saved evidence remains readable.',
  rate_limited: 'The archive request limit was reached. Retry explicitly later.',
  provider_quota: 'A source or archive provider is limiting requests. Retry explicitly later.',
  provider_suspended: 'An archive provider is suspended or disabled. Contact the operator; saved cases remain usable.',
  capture_busy: 'Another capture is in progress. Retry explicitly after it finishes.',
  capture_pending: 'Evidence capture is pending. Retry explicitly after it finishes.',
  capture_interrupted: 'Evidence capture was interrupted. Retry explicitly; no incomplete evidence is available.',
  capture_uncertain: 'Capture publication could not be confirmed. Retrieve or retry explicitly.',
  configuration_error: 'The archive connection is not configured. Existing local cases remain usable.',
};
export class ArchiveEvidenceError extends Error {
  readonly code: string;
  constructor(code:string,expired=false) { super((Object.hasOwn(messages,code)?messages[code]:messages.archive_unavailable)+(expired?' '+messages.artifact_expired:'')); this.name='ArchiveEvidenceError';this.code=Object.hasOwn(messages,code)?code:'archive_unavailable'; }
}
export function archiveEvidenceFailure(error:unknown):ArchiveEvidenceError { return error instanceof ArchiveEvidenceError?error:new ArchiveEvidenceError('archive_unavailable'); }
async function jsonResponse(response: Response): Promise<unknown> {
  const bytes = response.body ? await readBoundedStream(response.body, 1_048_576) : new Uint8Array();
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { body = null; }
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string() }), archiveEvidence: z.literal('expired').optional() }).safeParse(body);
    throw new ArchiveEvidenceError(error.success?error.data.error.code:'archive_unavailable',error.success&&error.data.archiveEvidence==='expired');
  }
  return body;
}
function requestSignal(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(90_000)]);
}
export type CatalogSearch = { mode?: 'historical'; significantOnly?: boolean; start?: string; end?: string; eventId?: string; minMagnitude?: string; maxMagnitude?: string; minLatitude?: string; maxLatitude?: string; minLongitude?: string; maxLongitude?: string };
export async function discoverRecentEarthquakes(options: CatalogSearch & { offset?: number; signal?: AbortSignal }): Promise<CatalogPage> {
  const query = new URLSearchParams({ offset: String(options.offset ?? 0) });
  if (!options.eventId) query.set('significant', String(options.significantOnly ?? !options.mode));
  for (const key of ['mode', 'start', 'end', 'eventId', 'minMagnitude', 'maxMagnitude', 'minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude'] as const) {
    if (options[key] !== undefined) query.set(key, options[key]);
  }
  const response = await fetch(`/api/exposure/catalog?${query}`, { signal: requestSignal(options.signal), cache: 'no-store' });
  const parsed = catalogPageSchema.safeParse(await jsonResponse(response));
  if (!parsed.success) throw new Error('The earthquake catalog returned an invalid response. Previous results remain unchanged.');
  return parsed.data;
}
const sourceUrl = z.string().url().refine(value => { const url = new URL(value); return url.origin === 'https://earthquake.usgs.gov' && !url.username && !url.password; });
const artifactSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(33_554_432), sourceUrl, path: z.string(), contentType: z.string() })
  .refine(value => value.path === `/api/artifacts/${value.sha256}`);
const manifestSchema = z.object({
  schemaVersion: z.literal(1), event: z.object({ id: eventId, aliases: z.array(eventId).max(100), name: z.string().min(1).max(1000), occurredAt: z.string().datetime(), updatedAt: z.string().datetime() }),
  product: z.object({ id: z.string().min(1).max(1000), source: z.string().min(1).max(200), code: z.string().max(200), updatedAt: z.string().datetime(), retrospective: z.boolean() }),
  capturedAt: z.string().datetime(), artifacts: z.object({ detail: artifactSchema, grid: artifactSchema }),
});
const detailSchema = z.object({ id: eventId, properties: z.object({ mag: z.number().finite().nullable(), time: z.number().finite(), updated: z.number().finite() }), geometry: z.object({ coordinates: z.array(z.number().finite()).min(2) }) });
async function original(artifact: z.infer<typeof artifactSchema>, signal: AbortSignal): Promise<string> {
  const response = await fetch(`/api/exposure/artifacts/${artifact.sha256}`, { signal, cache: 'no-store' });
  if (!response.ok) { await jsonResponse(response); throw new Error('Original evidence is unavailable.'); }
  if (!response.body) throw new ArchiveEvidenceError('object_store_unavailable');
  const bytes = await readBoundedStream(response.body, artifact.bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== artifact.bytes || actual !== artifact.sha256) throw new ArchiveEvidenceError('evidence_integrity');
  // Preserve a UTF-8 BOM in retained originals; strip only for JSON interpretation below.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
async function readArchivedEarthquake(id: string, signal?: AbortSignal, checkSource = false): Promise<EarthquakeCapture> {
  eventId.parse(id);
  const boundedSignal = requestSignal(signal);
  const response = await fetch(checkSource?'/api/exposure/captures/check':'/api/exposure/captures', { method: 'POST', signal: boundedSignal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: id }), cache: 'no-store' });
  const parsed = manifestSchema.safeParse(await jsonResponse(response));
  if (!parsed.success) throw new ArchiveEvidenceError('source_integrity');
  const manifest = parsed.data;
  if(id!==manifest.event.id&&!manifest.event.aliases.includes(id))throw new ArchiveEvidenceError('identity_conflict');
  const detailText = await original(manifest.artifacts.detail, boundedSignal);
  let detail:z.infer<typeof detailSchema>;
  try{detail=detailSchema.parse(JSON.parse(detailText.replace(/^\uFEFF/, '')));}catch{throw new ArchiveEvidenceError('source_integrity');}
  if (detail.id !== manifest.event.id) throw new ArchiveEvidenceError('identity_conflict');
  const event: Earthquake = earthquakeSchema.parse({ id: manifest.event.id, name: manifest.event.name, magnitude: detail.properties.mag,
    latitude: detail.geometry.coordinates[1], longitude: detail.geometry.coordinates[0], occurredAt: manifest.event.occurredAt, updatedAt: manifest.event.updatedAt });
  const rawXml = await original(manifest.artifacts.grid, boundedSignal);
  let evidence:Awaited<ReturnType<typeof captureEvidence>>;
  try {evidence = await captureEvidence(rawXml, { eventId: event.id, aliases: manifest.event.aliases, eventName: event.name, magnitude: event.magnitude,
    longitude: event.longitude, latitude: event.latitude, occurredAt: event.occurredAt, productId: manifest.product.id, provider: manifest.product.source,
    productUpdatedAt: manifest.product.updatedAt, capturedAt: manifest.capturedAt, retrospective: manifest.product.retrospective, sourceUrl: manifest.artifacts.grid.sourceUrl },
    manifest.artifacts.grid.sha256, { url: manifest.artifacts.detail.sourceUrl, text: detailText });
  }catch(error){
    if(error instanceof Error&&(/SHA-256|event identity/.test(error.message)))throw new ArchiveEvidenceError('evidence_integrity');
    const units={MMI:['intensity','mmi'],LAT:['dd'],LON:['dd']};
    for(const tag of rawXml.matchAll(/<grid_field\b[^>]*>/g)){
      const name=tag[0].match(/\bname\s*=\s*['"]([^'"]+)['"]/)?.[1],unit=tag[0].match(/\bunits\s*=\s*['"]([^'"]*)['"]/)?.[1];
      if(name&&Object.hasOwn(units,name)&&unit!==undefined&&!units[name as keyof typeof units].includes(unit))throw new ArchiveEvidenceError('unsupported_units');
    }
    throw new ArchiveEvidenceError('unsupported_layout');
  }
  if (evidence.manifest.eventDetailSha256 !== manifest.artifacts.detail.sha256) throw new ArchiveEvidenceError('evidence_integrity');
  return { event, evidence, reason: null };
}

export async function captureArchivedEarthquake(id:string,signal?:AbortSignal):Promise<EarthquakeCapture>{
  try{return await readArchivedEarthquake(id,signal);}catch(error){throw archiveEvidenceFailure(error);}
}

export async function checkArchivedEarthquake(id:string,signal?:AbortSignal):Promise<EarthquakeCapture>{
  try{return await readArchivedEarthquake(id,signal,true);}catch(error){throw archiveEvidenceFailure(error);}
}
