import { useState } from 'react';
import { functionalUpdate, type OnChangeFn, type SortingState } from '@tanstack/react-table';

// Amounts are comparable only within a currency; currency groups stay A–Z.
export function useCurrencySorting(onChange?: () => void) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const onSortingChange: OnChangeFn<SortingState> = updater => {
    setSorting(previous => {
      const next = functionalUpdate(updater, previous);
      const valueSort = next.find(sort => sort.id === 'value');
      return valueSort ? [{ id: 'currency', desc: false }, valueSort] : next.filter(sort => sort.id !== 'currency');
    });
    onChange?.();
  };
  return { sorting, onSortingChange };
}

type SortableColumn = {
  getIsSorted: () => false | 'asc' | 'desc';
  getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
};
export function TableSortHeader({ column, label }: { column: SortableColumn; label: string }) {
  const sorted = column.getIsSorted();
  return <th scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
    <button className="table-sort-header" type="button" aria-label={`Sort by ${label.toLowerCase()}`} onClick={column.getToggleSortingHandler()}>{label}<span aria-hidden="true"> {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}</span></button>
  </th>;
}
