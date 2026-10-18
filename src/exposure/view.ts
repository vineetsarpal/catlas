import { prioritize, type ExposureRow } from './model';

export type ExposureView = {
  status: string;
  currency: string;
  query: string;
  region: string | null;
  businessLine: string | null;
};

export function filterExposure(rows: ExposureRow[], threshold: number, view: ExposureView): ExposureRow[] {
  const query = view.query.trim().toLocaleLowerCase();
  return prioritize(rows).filter(row =>
    (view.currency === 'all' || row.currency === view.currency) &&
    (view.region === null || row.region === view.region) &&
    (view.businessLine === null || row.businessLine === view.businessLine) &&
    (!query || [row.name, row.id, row.region, row.businessLine].some(value => value.toLocaleLowerCase().includes(query))) &&
    (view.status === 'all' ||
      view.status === 'unknown' && row.mmi === null ||
      view.status === 'meeting' && row.mmi !== null && row.mmi >= threshold ||
      view.status === 'below' && row.mmi !== null && row.mmi < threshold));
}

export function regionExposure(rows: ExposureRow[], threshold: number) {
  const groups = new Map<string, { region: string; total: number; meeting: number; unknown: number; unknownValue: number; values: Map<string, number> }>();
  for (const row of rows) {
    const group = groups.get(row.region) ?? { region: row.region, total: 0, meeting: 0, unknown: 0, unknownValue: 0, values: new Map<string, number>() };
    group.total++;
    if (row.mmi === null) group.unknown++;
    else if (row.mmi >= threshold) {
      group.meeting++;
      if (row.value === null) group.unknownValue++;
      else group.values.set(row.currency, (group.values.get(row.currency) ?? 0) + row.value);
    }
    groups.set(row.region, group);
  }
  return [...groups.values()].sort((a, b) => b.meeting - a.meeting || b.unknown - a.unknown || a.region.localeCompare(b.region));
}
