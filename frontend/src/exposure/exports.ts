import { z } from 'zod';
import { assessExposure, intensityBand, sha256, type CapturedEvidence, type Investigation } from './model';
import { MAX_GRID_BYTES, readBoundedStream } from './evidence';
import { restoreEvidence } from './repository';
import { verifyInvestigation } from './investigation';

const bundleSchema = z.object({ format: z.literal('catlas-exposure-case'), schemaVersion: z.literal(1),
  record: z.unknown(), rawXml: z.string().max(MAX_GRID_BYTES).nullable(), rawEventJson: z.string().max(8 * 1024 * 1024).nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function encodeBundle(record: Investigation, evidence: CapturedEvidence | null): Promise<Blob> {
  const value = await verifyInvestigation(record);
  if (record.evidence && (!evidence || record.evidence.rawSha256 !== await sha256(evidence.rawXml))) throw new Error('Frozen evidence is required for a portable case.');
  const payload = { format: 'catlas-exposure-case' as const, schemaVersion: 1 as const, record: value, rawXml: evidence?.rawXml ?? null, rawEventJson: evidence?.rawEventJson ?? null };
  const text = JSON.stringify({ ...payload, sha256: await sha256(JSON.stringify(payload)) });
  const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(compressed).arrayBuffer()], { type: 'application/gzip' });
}
export async function decodeBundle(file: Blob): Promise<{ record: Investigation; evidence: CapturedEvidence | null }> {
  if (file.size > 32 * 1024 * 1024) throw new Error('Case bundle exceeds the 32 MB compressed limit.');
  const bytes = await readBoundedStream(file.stream().pipeThrough(new DecompressionStream('gzip')), MAX_GRID_BYTES + 12 * 1024 * 1024);
  const envelope = bundleSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const { sha256: expected, ...payload } = envelope;
  if (expected !== await sha256(JSON.stringify(payload))) throw new Error('Case bundle integrity check failed.');
  const record = await verifyInvestigation(envelope.record);
  if ((record.evidence === null) !== (envelope.rawXml === null)) throw new Error('Case bundle evidence is incomplete.');
  const evidence = record.evidence && envelope.rawXml ? await restoreEvidence(record.evidence, envelope.rawXml, envelope.rawEventJson) : null;
  const expectedAssessment = assessExposure(record.portfolio, evidence?.grid ?? null, record.settings);
  if (JSON.stringify(record.rows) !== JSON.stringify(expectedAssessment.rows) || JSON.stringify(record.summary) !== JSON.stringify(expectedAssessment.summary))
    throw new Error('Case results do not reproduce from the bundled evidence and settings.');
  return { record, evidence };
}
export function downloadFile(filename: string, blob: Blob): void {
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
export function exposureCSV(record: Investigation): string {
  const columns = ['location_id','name','longitude','latitude','total_insured_value','currency','region','business_line','mmi','intensity_band','classification','investigation_id','version','threshold_mmi','portfolio_source','portfolio_as_of','product_id','raw_grid_sha256','excluded_rows'];
  return columns.join(',') + '\r\n' + record.rows.map(row => [row.id,row.name,row.longitude,row.latitude,row.value,row.currency,row.region,row.businessLine,row.mmi,intensityBand(row.mmi),
    row.mmi === null ? row.reason : row.mmi >= record.settings.threshold ? 'meets-threshold' : 'below-threshold',record.id,record.version,record.settings.threshold,record.portfolio.source,record.portfolio.asOf,
    record.evidence?.productId ?? '',record.evidence?.rawSha256 ?? '',record.portfolio.excludedRows].map(csvCell).join(',')).join('\r\n');
}
