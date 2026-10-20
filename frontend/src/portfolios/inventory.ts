import { z } from 'zod';
import { portfolioInventorySchema, type Portfolio } from '../exposure/model';
import type { ImportPreview } from '../exposure/portfolio';

export const managedPortfolioSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(200),
  revision: z.number().int().positive(), updatedAt: z.string().datetime(),
  data: portfolioInventorySchema,
}).strict();
export type ManagedPortfolio = z.infer<typeof managedPortfolioSchema>;
export type ImportMode = 'merge' | 'replace';
export function planImport(current: Portfolio, preview: ImportPreview, mode: ImportMode) {
  const old = new Map(current.locations.map(row => [row.id, row]));
  const incoming = new Map(preview.locations.map(row => [row.id, row]));
  const added = preview.locations.filter(row => !old.has(row.id));
  const changed = preview.locations.filter(row => old.has(row.id) && JSON.stringify(old.get(row.id)) !== JSON.stringify(row));
  const removed = mode === 'replace' ? current.locations.filter(row => !incoming.has(row.id)) : [];
  const locations = mode === 'replace' ? preview.locations : [
    ...current.locations.map(row => incoming.get(row.id) ?? row), ...added,
  ];
  const data = portfolioInventorySchema.parse({ ...current, locations, synthetic: mode === 'replace' ? false : current.synthetic,
    excludedRows: mode === 'replace' ? preview.excluded.length : current.excludedRows + preview.excluded.length,
    warnings: mode === 'replace' ? [...preview.excluded, ...preview.warnings] : [...current.warnings, ...preview.excluded, ...preview.warnings].slice(-2000),
  });
  return { data, added, changed, removed, unchanged: preview.locations.length - added.length - changed.length };
}
export function inventoryCSV(portfolio: Portfolio): string {
  const cell = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return 'location_id,name,longitude,latitude,total_insured_value,currency,region,business_line\r\n' +
    portfolio.locations.map(row => [row.id,row.name,row.longitude,row.latitude,row.value,row.currency,row.region,row.businessLine].map(cell).join(',')).join('\r\n');
}
export const emptyPortfolio: Portfolio = { source: 'Manual entry', asOf: new Date().toLocaleDateString('en-CA'), synthetic: false, locations: [], excludedRows: 0, warnings: [] };
