import type { InsuredLocation } from '../exposure/model';

export const LOCATION_PAGE_SIZE = 100;

export function summarizeLocations(rows: Pick<InsuredLocation, 'value' | 'currency'>[]) {
  const values = new Map<string, number>();
  let unknown = 0;
  for (const row of rows) {
    if (row.value === null) unknown++;
    else values.set(row.currency, (values.get(row.currency) ?? 0) + row.value);
  }
  return { count: rows.length, unknown, values: [...values].sort(([a], [b]) => a.localeCompare(b)) };
}

export function FilteredLocationSummary({ rows, total }: { rows: Pick<InsuredLocation, 'value' | 'currency'>[]; total: number }) {
  const summary = summarizeLocations(rows);
  return <div className="location-filtered-summary" aria-label="Filtered locations summary" role="status">
    <span>{summary.count.toLocaleString()} of {total.toLocaleString()} locations</span>
    <span> · Known insured value: {summary.values.length ? summary.values.map(([currency, value]) => `${new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)} ${currency}`).join(' · ') : 'Not supplied'}</span>
    <span> · Unknown insured value: {summary.unknown.toLocaleString()} locations</span>
  </div>;
}

type PaginationTable = {
  getCanPreviousPage: () => boolean;
  getCanNextPage: () => boolean;
  previousPage: () => void;
  nextPage: () => void;
};

export function LocationPagination({ table, page, total }: { table: PaginationTable; page: number; total: number }) {
  const start = total ? page * LOCATION_PAGE_SIZE + 1 : 0;
  const end = Math.min((page + 1) * LOCATION_PAGE_SIZE, total);
  return <nav className="exposure-pagination" aria-label="Location pages">
    <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Previous locations</button>
    <span>{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} locations</span>
    <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next locations</button>
  </nav>;
}

export function LocationFilterChips({ chips, onClear }: { chips: { id: string; label: string; remove: () => void }[]; onClear: () => void }) {
  if (!chips.length) return null;
  return <div className="atlas-active-filters" aria-label="Active location filters">{chips.map(chip => <button key={chip.id} onClick={chip.remove} aria-label={`Remove ${chip.label}`}>{chip.label} <span aria-hidden="true">×</span></button>)}<button onClick={onClear}>Clear filters</button></div>;
}
