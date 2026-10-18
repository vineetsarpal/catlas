import { z } from 'zod';

export const MAX_LOCATIONS = 1_000;
export const SAMPLER_VERSION = 'bilinear-mmi-axes-1' as const;
export const siteSchema = z.object({
  id: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(500),
  longitude: z.number().finite().min(-180).max(180), latitude: z.number().finite().min(-90).max(90),
  value: z.number().finite().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/),
  region: z.string().max(500), businessLine: z.string().max(500),
}).strict();
export type InsuredLocation = z.infer<typeof siteSchema>;
export const portfolioSchema = z.object({
  source: z.string().trim().min(1).max(500), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid portfolio date'), synthetic: z.boolean(),
  locations: z.array(siteSchema).min(1).max(MAX_LOCATIONS), excludedRows: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(1000)).max(MAX_LOCATIONS * 2),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.locations.map(s => s.id)).size !== p.locations.length)
    ctx.addIssue({ code: 'custom', message: 'Location IDs must be unique.' });
});
export type Portfolio = z.infer<typeof portfolioSchema>;
export type ShakingGrid = { longitudes: number[]; latitudes: number[]; values: (number | null)[] };
export const evidenceManifestSchema = z.object({
  eventId: z.string().min(1).max(200), aliases: z.array(z.string()).max(100), eventName: z.string().max(1000),
  occurredAt: z.string().datetime(), magnitude: z.number().finite().nullable(), longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90),
  productId: z.string().min(1).max(1000), provider: z.string().min(1).max(200), productVersion: z.string().max(100),
  productUpdatedAt: z.string().datetime(), processedAt: z.string().min(1).max(100), capturedAt: z.string().datetime(),
  sourceUrl: z.string().url(), rawSha256: z.string().regex(/^[a-f0-9]{64}$/), retrospective: z.boolean(),
  eventDetailUrl: z.string().url().nullable(), eventDetailSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  measure: z.literal('MMI'), units: z.literal('intensity'),
}).strict().refine(value => (value.eventDetailUrl === null) === (value.eventDetailSha256 === null), 'Event detail URL and hash must be supplied together.');
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export type CapturedEvidence = { manifest: EvidenceManifest; rawXml: string; rawEventJson: string | null; grid: ShakingGrid };
export const settingsSchema = z.object({ threshold: z.number().finite().min(1).max(10), sampler: z.literal(SAMPLER_VERSION) }).strict();
export type AnalysisSettings = z.infer<typeof settingsSchema>;
export const rowSchema = siteSchema.extend({ mmi: z.number().finite().min(1).max(12).nullable(), reason: z.enum(['estimated', 'outside-grid', 'missing-samples', 'evidence-unavailable']) }).strict();
export type ExposureRow = z.infer<typeof rowSchema>;
export const summarySchema = z.object({
  total: z.number().int().nonnegative(), meetingThreshold: z.number().int().nonnegative().nullable(),
  belowThreshold: z.number().int().nonnegative().nullable(), unknownIntensity: z.number().int().nonnegative(),
  knownValueByCurrency: z.record(z.string(), z.number().finite().nonnegative()).nullable(), unknownValueCount: z.number().int().nonnegative(),
}).strict();
export type ExposureSummary = z.infer<typeof summarySchema>;
export const earthquakeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().min(1).max(1000),
  magnitude: z.number().finite().nullable(), longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90),
  occurredAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type Earthquake = z.infer<typeof earthquakeSchema>;
export const investigationSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), caseId: z.string().uuid(), version: z.number().int().positive(),
  previousId: z.string().uuid().nullable(), createdAt: z.string().datetime(),
  event: earthquakeSchema, portfolio: portfolioSchema, portfolioHash: z.string().regex(/^[a-f0-9]{64}$/), settings: settingsSchema,
  evidence: evidenceManifestSchema.nullable(), unavailableReason: z.string().max(2000).nullable(),
  rows: z.array(rowSchema).max(MAX_LOCATIONS), summary: summarySchema,
}).strict().superRefine((record, ctx) => {
  if (record.rows.length !== record.portfolio.locations.length || record.rows.length !== record.summary.total ||
      record.rows.some((r, i) => r.id !== record.portfolio.locations[i].id))
    ctx.addIssue({ code: 'custom', message: 'Case rows do not match the supplied portfolio.' });
  if ((record.version === 1) !== (record.previousId === null))
    ctx.addIssue({ code: 'custom', message: 'Invalid investigation version link.' });
  if (record.evidence === null && (!record.unavailableReason || record.summary.meetingThreshold !== null || record.rows.some(r => r.mmi !== null)))
    ctx.addIssue({ code: 'custom', message: 'Unavailable evidence cannot assert numeric exposure classification.' });
});
export type Investigation = z.infer<typeof investigationSchema>;

function bracket(axis: number[], coordinate: number): number {
  let low = 0, high = axis.length - 1;
  while (low + 1 < high) { const middle = (low + high) >>> 1; if (axis[middle] <= coordinate) low = middle; else high = middle; }
  return low;
}
export function sampleMMI(grid: ShakingGrid, longitude: number, latitude: number): Pick<ExposureRow, 'mmi' | 'reason'> {
  const x = grid.longitudes, y = grid.latitudes;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < x[0] || longitude > x.at(-1)! || latitude < y[0] || latitude > y.at(-1)!)
    return { mmi: null, reason: 'outside-grid' };
  const i = bracket(x, longitude), j = bracket(y, latitude);
  const u = (longitude - x[i]) / (x[i + 1] - x[i]), v = (latitude - y[j]) / (y[j + 1] - y[j]);
  const nodes = [[i, j, (1 - u) * (1 - v)], [i + 1, j, u * (1 - v)], [i, j + 1, (1 - u) * v], [i + 1, j + 1, u * v]];
  let mmi = 0;
  for (const [column, row, weight] of nodes) {
    if (weight === 0) continue;
    const value = grid.values[row * x.length + column];
    if (value === null || !Number.isFinite(value)) return { mmi: null, reason: 'missing-samples' };
    mmi += value * weight;
  }
  return { mmi, reason: 'estimated' };
}
export const intensityBand = (mmi: number | null) => mmi === null ? 'Unknown' : mmi < 4 ? '<4' : mmi < 5 ? '4–<5' : mmi < 6 ? '5–<6' : mmi < 7 ? '6–<7' : '7+';
export const bandOrder = (mmi: number | null) => mmi === null ? -1 : mmi < 4 ? 0 : mmi < 5 ? 1 : mmi < 6 ? 2 : mmi < 7 ? 3 : 4;
export const intensityColor = (mmi: number | null) => mmi === null ? '#9eabba' : mmi < 4 ? '#5598af' : mmi < 5 ? '#51c1ab' : mmi < 6 ? '#e2d273' : mmi < 7 ? '#ef9f53' : '#dc5c49';
export function prioritize(rows: ExposureRow[]): ExposureRow[] {
  return [...rows].sort((a, b) => bandOrder(b.mmi) - bandOrder(a.mmi) || a.currency.localeCompare(b.currency) || (b.value ?? -1) - (a.value ?? -1) || a.id.localeCompare(b.id));
}
export function assessExposure(portfolio: Portfolio, grid: ShakingGrid | null, settings: AnalysisSettings): { rows: ExposureRow[]; summary: ExposureSummary } {
  const rows = portfolio.locations.map(site => ({ ...site, ...(grid ? sampleMMI(grid, site.longitude, site.latitude) : { mmi: null, reason: 'evidence-unavailable' as const }) }));
  const selected = rows.filter(r => r.mmi !== null && r.mmi >= settings.threshold);
  const unknownIntensity = rows.filter(r => r.mmi === null).length;
  const values: Record<string, number> = {};
  for (const row of selected) if (row.value !== null) values[row.currency] = (values[row.currency] ?? 0) + row.value;
  if (Object.values(values).some(value => !Number.isFinite(value))) throw new Error('Insured value totals exceed supported numeric range.');
  return { rows, summary: { total: rows.length, meetingThreshold: grid ? selected.length : null,
    belowThreshold: grid ? rows.length - selected.length - unknownIntensity : null, unknownIntensity,
    knownValueByCurrency: grid ? values : null, unknownValueCount: selected.filter(r => r.value === null).length } };
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
