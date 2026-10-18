import { describe, expect, it } from 'vitest';
import { assessExposure, sampleMMI, SAMPLER_VERSION, prioritize, type ShakingGrid } from './model';
import { demoPortfolio, stressPortfolio } from './fixtures';
import { confirmPortfolio, CSV_TEMPLATE, previewPortfolio } from './portfolio';
import { parseShakingGrid } from './evidence';
const grid: ShakingGrid = { longitudes: [0, 1], latitudes: [0, 1], values: [4, 6, 6, 8] };
describe('numeric shaking and exposure boundaries', () => {
 it('interpolates a known surface, samples exact outer nodes, and never extrapolates', () => {
   expect(sampleMMI(grid, .5, .5).mmi).toBe(6);
   expect(sampleMMI(grid, 1, 1).mmi).toBe(8);
   expect(sampleMMI(grid, 1 + Number.EPSILON, .5)).toEqual({ mmi: null, reason: 'outside-grid' });
   expect(sampleMMI({ ...grid, values: [4,null,null,null] }, 0, 0).mmi).toBe(4);
   expect(sampleMMI({ ...grid, values: [4,null,6,8] }, .5, .5).reason).toBe('missing-samples');
 });
 it('compares full precision and reconciles counts/values without mixing currencies', () => {
   const locations = demoPortfolio.locations.slice(0,4).map((s,i) => ({ ...s, longitude: [0,.5,1,2][i], latitude: 0, value: i===1?null:100, currency: i===2?'CAD':'USD' }));
   const p = { ...demoPortfolio, locations };
   const exact = assessExposure(p, grid, { threshold: 5, sampler: SAMPLER_VERSION });
   expect(exact.summary).toEqual({ total:4, meetingThreshold:2, belowThreshold:1, unknownIntensity:1, knownValueByCurrency:{CAD:100}, unknownValueCount:1 });
   expect(assessExposure(p, grid, { threshold:5 + 1e-10, sampler:SAMPLER_VERSION }).summary.meetingThreshold).toBe(1);
   expect(assessExposure(p, null, { threshold:4, sampler:SAMPLER_VERSION }).summary).toMatchObject({ meetingThreshold:null, belowThreshold:null, unknownIntensity:4, knownValueByCurrency:null });
   expect(prioritize(exact.rows).map(s=>s.currency).slice(0,2)).toEqual(['CAD','USD']);
 });
 it('handles the agreed baseline and a separate larger diagnostic without truncating the calculation', () => {
   for (const count of [1000,10000]) expect(assessExposure(stressPortfolio(count), null, {threshold:4,sampler:SAMPLER_VERSION}).summary.total).toBe(count);
 });
});
describe('portfolio ingestion', () => {
 it('keeps unknown values and co-located identities while disclosing invalid rows', () => {
   const text=CSV_TEMPLATE+'OTHER,"A, named site",-117.67,35.62,,CAD,Kern,Commercial\nBAD,Invalid,,35,100,USD,Kern,Commercial\n';
   const preview=previewPortfolio(text);
   expect(preview.locations).toHaveLength(2); expect(preview.locations[1]).toMatchObject({name:'A, named site',value:null,currency:'CAD'});
   expect(preview.excluded).toHaveLength(1);expect(preview.warnings).toHaveLength(1);
   expect(confirmPortfolio(preview,'PAS export','2019-07-05').excludedRows).toBe(1);
   expect(()=>confirmPortfolio(preview,'','2019-07-05')).toThrow();
   expect(()=>confirmPortfolio(preview,'PAS','2019-02-30')).toThrow();
 });
 it('rejects duplicate IDs, malformed quoting and oversize portfolios without silent truncation', () => {
   expect(()=>previewPortfolio(CSV_TEMPLATE+CSV_TEMPLATE.split('\n')[1])).toThrow('duplicate location ID');
   expect(()=>previewPortfolio(CSV_TEMPLATE+'"bad')).toThrow('unclosed');
   expect(()=>previewPortfolio(CSV_TEMPLATE+Array.from({length:1000},(_,i)=>`X${i},Name,0,0,1,USD,R,B`).join('\n'))).toThrow('No rows were imported or truncated');
 });
});
describe('restricted USGS grid reader', () => {
 const xml=`<shakemap_grid event_id="x" shakemap_version="1" process_timestamp="now"><event event_id="x"/><grid_specification nlon="2" nlat="2"/><grid_field name="MMI" index="1" units="intensity"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="LON" index="3" units="dd"/><grid_data>6 1 0\n8 1 1\n4 0 0\n6 0 1</grid_data></shakemap_grid>`;
 it('uses named fields, preserves supplied axes and reverses north-first rows',()=>{expect(parseShakingGrid(xml).grid).toEqual(grid);});
 it('rejects unsafe XML, incompatible units and irregular coordinates; invalid MMI stays unknown',()=>{
   expect(()=>parseShakingGrid('<!DOCTYPE x>'+xml)).toThrow('Unsupported');
   expect(()=>parseShakingGrid(xml.replace('intensity','g'))).toThrow('units');
   expect(()=>parseShakingGrid(xml.replace('4 0 0','4 0 .1'))).toThrow('rectangular');
   expect(parseShakingGrid(xml.replace('4 0 0','-999 0 0')).grid.values[0]).toBeNull();
 });
});
