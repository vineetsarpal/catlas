import { describe, expect, it } from 'vitest';
import { demoPortfolio } from '../exposure/fixtures';
import { portfolioInventorySchema, portfolioSchema } from '../exposure/model';
import { previewPortfolio } from '../exposure/portfolio';
import { investigate } from '../exposure/investigation';
import { inventoryCSV, planImport } from './inventory';

describe('working portfolio import and snapshot boundaries', () => {
  it('merges by ID, replaces explicitly, and never changes the original inventory', () => {
    const original = structuredClone(demoPortfolio);
    const first = { ...original.locations[0], name: 'Updated location', value: null };
    const extra = { ...original.locations[1], id: 'NEW' };
    const preview = { locations: [first,extra], excluded: ['Invalid coordinates excluded'], warnings: [], totalRows: 3 };
    const merged = planImport(original,preview,'merge');
    expect(merged.data.locations).toHaveLength(19);
    expect(merged.changed.map(row=>row.id)).toEqual([first.id]);
    expect(merged.added.map(row=>row.id)).toEqual(['NEW']);
    expect(merged.data.excludedRows).toBe(1);
    const replaced = planImport(original,preview,'replace');
    expect(replaced.data.locations).toEqual([first,extra]);
    expect(replaced.removed).toHaveLength(17);
    expect(original).toEqual(demoPortfolio);
  });
  it('rejects an oversized merged result even when the imported file is within capacity', () => {
    const original = { ...demoPortfolio, locations: Array.from({length:1000},(_,i)=>({...demoPortfolio.locations[0],id:String(i)})) };
    expect(()=>planImport(original,{ locations:[{...demoPortfolio.locations[0],id:'NEW'}],excluded:[],warnings:[],totalRows:1 },'merge')).toThrow();
  });
  it('allows empty working portfolios without weakening investigation verification', () => {
    const empty = { ...demoPortfolio, locations: [] };
    expect(portfolioInventorySchema.safeParse(empty).success).toBe(true);
    expect(portfolioSchema.safeParse(empty).success).toBe(false);
  });
  it('retains the named portfolio reference in a frozen investigation independently of later edits', async () => {
    const reference={id:crypto.randomUUID(),name:'US Property',revision:1};
    const record=await investigate({event:{id:'test',name:'Test earthquake',magnitude:6,longitude:0,latitude:0,occurredAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},portfolio:demoPortfolio,evidence:null,threshold:4,portfolioReference:reference});
    reference.name='Renamed portfolio';
    expect(record.portfolioReference?.name).toBe('US Property');
    expect(record.portfolioReference?.revision).toBe(1);
  });
  it('exports a round-trippable inventory, preserving null values, quotes, commas and line breaks', () => {
    const original = { ...demoPortfolio, locations:[{...demoPortfolio.locations[0], name:'Warehouse, "North"\nBuilding 2',value:null}] };
    expect(previewPortfolio(inventoryCSV(original)).locations).toEqual(original.locations);
  });
});
