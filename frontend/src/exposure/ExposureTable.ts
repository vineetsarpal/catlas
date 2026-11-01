import { createColumnHelper, createPaginatedRowModel, createSortedRowModel, functionalUpdate, rowPaginationFeature, rowSortingFeature, sortFn_basic, sortFn_text, tableFeatures, useTable } from '@tanstack/react-table';
import { useEffect } from 'react';
import { useCurrencySorting } from '../components/TableSortHeader';
import { LOCATION_PAGE_SIZE } from '../components/LocationTableControls';
import type { ExposureRow } from './model';

const features = tableFeatures({
  rowSortingFeature, sortedRowModel: createSortedRowModel(),
  rowPaginationFeature, paginatedRowModel: createPaginatedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
});
const column = createColumnHelper<typeof features, ExposureRow>();
const columns = column.columns([
  column.accessor('name', { sortFn: 'text' }),
  column.accessor(row => row.mmi ?? undefined, { id: 'mmi', sortFn: 'basic', sortUndefined: 'last' }),
  column.accessor(row => row.value ?? undefined, { id: 'value', sortFn: 'basic', sortUndefined: 'last' }),
  column.accessor('currency', { sortFn: 'text' }),
  column.accessor('region', { sortFn: 'text' }),
  column.accessor('businessLine', { sortFn: 'text' }),
]);

// Domain filters supply investigation-priority order. Table state only changes the view.
export function useExposureTable(data: ExposureRow[], page: number, setPage: (page: number) => void) {
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(data.length / LOCATION_PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [data.length, page, setPage]);
  const { sorting, onSortingChange } = useCurrencySorting(() => setPage(0));
  const table = useTable({
    features, columns, data, getRowId: row => row.id,
    enableMultiSort: false, sortDescFirst: false, autoResetPageIndex: false,
    state: { sorting, pagination: { pageIndex: page, pageSize: LOCATION_PAGE_SIZE } },
    onSortingChange,
    onPaginationChange: updater => setPage(functionalUpdate(updater, { pageIndex: page, pageSize: LOCATION_PAGE_SIZE }).pageIndex),
  });
  return { table, pageRows: table.getRowModel().rows.map(row => row.original), rows: table.getPrePaginatedRowModel().rows.map(row => row.original), page, pageSize: LOCATION_PAGE_SIZE, pageCount: Math.ceil(data.length / LOCATION_PAGE_SIZE) };
}
