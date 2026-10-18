import { MAX_LOCATIONS, portfolioSchema, siteSchema, type InsuredLocation, type Portfolio } from './model';
export const CSV_TEMPLATE = 'location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\nDEMO-1,Example location,-117.67,35.62,18000000,USD,Kern,Commercial\n';

export type ImportPreview = { locations: InsuredLocation[]; excluded: string[]; warnings: string[]; totalRows: number };
function csvRows(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error('CSV exceeds the 2 MB import limit. No rows were imported.');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function previewPortfolio(text: string): ImportPreview {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift()?.map(value => value.trim().toLowerCase()) ?? [];
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names.');
  for (const required of ['location_id', 'name', 'longitude', 'latitude', 'total_insured_value', 'currency'])
    if (!headers.includes(required)) throw new Error(`Missing CSV column: ${required}`);
  if (!rows.length || rows.length > MAX_LOCATIONS) throw new Error(`Import supports 1–${MAX_LOCATIONS.toLocaleString()} locations. No rows were imported or truncated.`);
  const ids = new Set<string>(), coordinates = new Map<string, string>();
  const preview: ImportPreview = { locations: [], excluded: [], warnings: [], totalRows: rows.length };
  rows.forEach((row, index) => {
    const get = (key: string) => row[headers.indexOf(key)]?.trim() ?? '';
    const id = get('location_id');
    if (!id || ids.has(id)) throw new Error(`Row ${index + 2}: missing or duplicate location ID ${id || '(blank)'}. Correct IDs before importing.`);
    ids.add(id);
    const candidate = { id, name: get('name'), longitude: Number(get('longitude')), latitude: Number(get('latitude')),
      value: get('total_insured_value') === '' ? null : Number(get('total_insured_value')), currency: get('currency').toUpperCase(), region: get('region'), businessLine: get('business_line') };
    const parsed = siteSchema.safeParse(candidate);
    if (!get('longitude') || !get('latitude') || !parsed.success || row.length !== headers.length) {
      preview.excluded.push(`Row ${index + 2} (${id}): ${!get('longitude') || !get('latitude') ? 'missing coordinates' : !parsed.success ? parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ') : 'column count mismatch'}. Excluded.`);
      return;
    }
    const key = `${parsed.data.longitude},${parsed.data.latitude}`;
    if (coordinates.has(key)) preview.warnings.push(`${id} shares coordinates with ${coordinates.get(key)}; retained as a separate location.`);
    coordinates.set(key, id); preview.locations.push(parsed.data);
  });
  if (!preview.locations.length) throw new Error('No valid locations remain. Correct the CSV before importing.');
  return preview;
}
export function confirmPortfolio(preview: ImportPreview, source: string, asOf: string): Portfolio {
  return portfolioSchema.parse({ source, asOf, synthetic: false, locations: preview.locations,
    excludedRows: preview.excluded.length, warnings: [...preview.excluded, ...preview.warnings] });
}
