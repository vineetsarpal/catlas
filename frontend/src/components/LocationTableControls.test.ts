import { describe, expect, it } from 'vitest';
import { summarizeLocations } from './LocationTableControls';

describe('filtered location insured-value summary', () => {
  it('keeps currencies separate, includes known zero, and counts unknown values independently', () => {
    expect(summarizeLocations([
      { value: 120, currency: 'USD' },
      { value: 80, currency: 'USD' },
      { value: 50, currency: 'CAD' },
      { value: 0, currency: 'EUR' },
      { value: null, currency: 'USD' },
      { value: null, currency: 'CAD' },
    ])).toEqual({ count: 6, unknown: 2, values: [['CAD', 50], ['EUR', 0], ['USD', 200]] });
  });

  it('does not report a zero insured value when no values were supplied', () => {
    expect(summarizeLocations([{ value: null, currency: 'USD' }])).toEqual({ count: 1, unknown: 1, values: [] });
    expect(summarizeLocations([])).toEqual({ count: 0, unknown: 0, values: [] });
  });

  it('summarizes all matching locations when there are more than one table page', () => {
    expect(summarizeLocations(Array.from({ length: 105 }, () => ({ value: 10, currency: 'USD' }))))
      .toEqual({ count: 105, unknown: 0, values: [['USD', 1050]] });
  });
});
