import { describe, expect, it } from 'vitest';
import { demoPortfolio } from './fixtures';
import { filterExposure, regionExposure, type ExposureView } from './view';

const rows = demoPortfolio.locations.slice(0, 5).map((row, i) => ({ ...row,
  region: i < 3 ? 'North' : '', currency: i === 1 ? 'CAD' : 'USD',
  value: i === 2 ? null : 100, mmi: [4, 6, 7, null, 3][i],
  reason: i === 3 ? 'outside-grid' as const : 'estimated' as const,
}));
const all: ExposureView = { status: 'all', currency: 'all', query: '', region: null, businessLine: null };
describe('exposure investigation views', () => {
  it('combines search, region, currency and threshold filters without rewriting assessed rows', () => {
    const before = JSON.stringify(rows);
    const result = filterExposure(rows, 4, { ...all, status: 'meeting', region: 'North', currency: 'CAD', query: ' RIDGECREST ' });
    expect(result.map(row => row.id)).toEqual(['RC-02']);
    expect(filterExposure(rows, 4, { ...all, status: 'unknown', region: '' }).map(row => row.id)).toEqual(['TR-02']);
    expect(filterExposure(rows, 4, { ...all, businessLine: 'Residential' }).map(row => row.id)).toEqual(['TR-02']);
    expect(filterExposure(rows, 4, { ...all, query: 'no such location' })).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('keeps regional counts, separate currencies and unknown values distinct', () => {
    const groups = regionExposure(rows, 4);
    expect(groups[0]).toMatchObject({ region: 'North', total: 3, meeting: 3, unknown: 0, unknownValue: 1 });
    expect([...groups[0].values]).toEqual([['USD', 100], ['CAD', 100]]);
    expect(groups[1]).toMatchObject({ region: '', total: 2, meeting: 0, unknown: 1, unknownValue: 0 });
    expect(regionExposure(rows, 6)[0].meeting).toBe(2);
    expect(regionExposure([], 4)).toEqual([]);
  });
});
