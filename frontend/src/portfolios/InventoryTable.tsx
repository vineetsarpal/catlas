import { useEffect, useMemo, useState } from 'react';
import { columnFilteringFeature, createColumnHelper, createFilteredRowModel, createPaginatedRowModel, createSortedRowModel, filterFn_includesString, functionalUpdate, globalFilteringFeature, rowPaginationFeature, rowSortingFeature, sortFn_basic, sortFn_text, tableFeatures, useTable } from '@tanstack/react-table';
import { useCurrencySorting } from '../components/TableSortHeader';
import { LOCATION_PAGE_SIZE } from '../components/LocationTableControls';
import type { InsuredLocation } from '../exposure/model';

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
});
const column = createColumnHelper<typeof features, InsuredLocation>();
// Encoded strings distinguish an unfiltered select from a real empty field.
const exactOption = (value: unknown, filter: unknown) => JSON.stringify(value) === filter;
const columns = column.columns([
  column.accessor('name', { sortFn: 'text' }),
  column.accessor('id', { enableSorting: false }),
  column.accessor('region', { sortFn: 'text', filterFn: (row, id, filter) => exactOption(row.getValue(id), filter) }),
  column.accessor('businessLine', { sortFn: 'text', filterFn: (row, id, filter) => exactOption(row.getValue(id), filter) }),
  column.accessor('currency', { sortFn: 'text', filterFn: (row, id, filter) => exactOption(row.getValue(id), filter) }),
  column.accessor(row => row.value ?? undefined, { id: 'value', sortFn: 'basic', sortUndefined: 'last' }),
  column.accessor(row => row.value === null ? 'unknown' : 'known', { id: 'valueStatus', enableSorting: false, filterFn: (row, id, filter) => exactOption(row.getValue(id), filter) }),
]);

export function useInventoryTable(data: InsuredLocation[]) {
  const [page, setPage] = useState(0);
  const { sorting, onSortingChange } = useCurrencySorting(() => setPage(0));
  const table = useTable({
    features, columns, data, getRowId: row => row.id, enableMultiSort: false, sortDescFirst: false,
    autoResetPageIndex: false,
    globalFilterFn: 'includesString',
    getColumnCanGlobalFilter: column => ['name', 'id', 'region', 'businessLine'].includes(column.id),
    state: { sorting, pagination: { pageIndex: page, pageSize: LOCATION_PAGE_SIZE } },
    onSortingChange,
    onPaginationChange: updater => setPage(functionalUpdate(updater, { pageIndex: page, pageSize: LOCATION_PAGE_SIZE }).pageIndex),
  });
  // Maps and totals represent every matching location, never just the current page.
  const rows = useMemo(() => table.getPrePaginatedRowModel().rows.map(row => row.original), [table, data, table.state.sorting, table.state.columnFilters, table.state.globalFilter]);
  const pageRows = table.getRowModel().rows.map(row => row.original);
  useEffect(() => { setPage(0); }, [table.state.columnFilters, table.state.globalFilter]);
  useEffect(() => { setPage(previous => Math.min(previous, Math.max(0, Math.ceil(rows.length / LOCATION_PAGE_SIZE) - 1))); }, [rows.length]);
  const options = useMemo(() => {
    const distinct = (key: 'currency' | 'region' | 'businessLine') => [...new Set(data.map(row => row[key]))].sort((a, b) => a.localeCompare(b));
    return { currency: distinct('currency'), region: distinct('region'), businessLine: distinct('businessLine') };
  }, [data]);
  const hasFilters = Boolean(table.state.globalFilter || table.state.columnFilters.length);
  const filterCount = table.state.columnFilters.length + Number(Boolean(table.state.globalFilter));
  const labels: Record<string, string> = { currency: 'Currency', region: 'Region', businessLine: 'Business line', valueStatus: 'Insured value' };
  const chips = table.state.columnFilters.map(filter => {
    let value = String(filter.value);
    try { value = String(JSON.parse(value)) || 'Not supplied'; } catch { /* Keep a malformed persisted filter visible and removable. */ }
    if (filter.id === 'valueStatus') value = value === 'known' ? 'Known values' : 'Unknown values';
    return { id: filter.id, label: `${labels[filter.id] ?? filter.id}: ${value}`, remove: () => table.getColumn(filter.id)?.setFilterValue(undefined) };
  });
  if (table.state.globalFilter) chips.unshift({ id: 'search', label: `Search: ${table.state.globalFilter}`, remove: () => table.resetGlobalFilter(true) });
  function clearFilters() { table.resetGlobalFilter(true); table.resetColumnFilters(true); setPage(0); }
  return { table, rows, pageRows, page, setPage, pageSize: LOCATION_PAGE_SIZE, pageCount: Math.ceil(rows.length / LOCATION_PAGE_SIZE), options, hasFilters, filterCount, chips, clearFilters };
}

type InventoryModel = ReturnType<typeof useInventoryTable>;

function ExactFilter({ model, columnId, label, values, all, labels }: { model: InventoryModel; columnId: string; label: string; values: string[]; all: string; labels?: Record<string, string> }) {
  const column = model.table.getColumn(columnId)!;
  const value = column.getFilterValue();
  const selected = typeof value === 'string' ? value : '';
  const options = values.map(value => ({ value: JSON.stringify(value), label: labels?.[value] ?? (value || 'Not supplied') }));
  // A reactive deletion must not make a still-active filter look like "All".
  if (selected && !options.some(option => option.value === selected)) {
    options.push({ value: selected, label: `${JSON.parse(selected) || 'Not supplied'} (no current locations)` });
  }
  return <label>{label}<select aria-label={`Filter ${label.toLowerCase()}`} value={selected} onChange={event => column.setFilterValue(event.target.value || undefined)}>
    <option value="">{all}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

export function InventoryFilters({ model, inline = false }: { model: InventoryModel; inline?: boolean }) {
  const fields = <div className="portfolio-inventory-filter-fields">
    <ExactFilter model={model} columnId="valueStatus" label="Insured value" values={['known', 'unknown']} all="All values" labels={{ known: 'Known values', unknown: 'Unknown values' }}/>
    <ExactFilter model={model} columnId="currency" label="Currency" values={model.options.currency} all="All currencies"/>
    <ExactFilter model={model} columnId="region" label="Region" values={model.options.region} all="All regions"/>
    <ExactFilter model={model} columnId="businessLine" label="Business line" values={model.options.businessLine} all="All business lines"/>
  </div>;
  return inline ? fields : <details className="portfolio-inventory-filters"><summary>Table filters</summary>{fields}</details>;
}
