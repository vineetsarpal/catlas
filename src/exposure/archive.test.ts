import { describe, expect, it } from 'vitest';
import { captureEvidence } from './evidence';
import { investigate, eventFromEvidence } from './investigation';
import { demoPortfolio } from './fixtures';
import { decodeBundle, encodeBundle, exposureCSV } from './exports';
const xml = '<shakemap_grid event_id="x" shakemap_version="1" process_timestamp="2026-01-01T00:00:00"><event event_id="x"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>0 1 6\n1 1 8\n0 0 4\n1 0 6</grid_data></shakemap_grid>';
async function frozen() { return captureEvidence(xml,{eventId:'x',aliases:[],eventName:'Test earthquake',occurredAt:'2026-01-01T00:00:00.000Z',magnitude:6,longitude:.5,latitude:.5,productId:'product-x-1',provider:'us',productUpdatedAt:'2026-01-01T01:00:00.000Z',capturedAt:'2026-01-01T02:00:00.000Z',sourceUrl:'https://earthquake.usgs.gov/example.xml',retrospective:false}); }
async function gzip(value:unknown) {return new Blob([await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()]);}
describe('self-contained exposure cases',()=>{
 it('reproduces original values/evidence and links revised versions without mutating the first',async()=>{
   const evidence=await frozen(),event=eventFromEvidence(evidence),portfolio={...demoPortfolio,locations:[{...demoPortfolio.locations[0],longitude:.5,latitude:.5}]};
   const first=await investigate({event,portfolio,evidence,threshold:4});
   const second=await investigate({event,portfolio,evidence,threshold:7,previous:first});
   expect(first.summary.meetingThreshold).toBe(1);expect(second.summary.meetingThreshold).toBe(0);expect(second.previousId).toBe(first.id);expect(second.version).toBe(2);
   const restored=await decodeBundle(await encodeBundle(first,evidence));
   expect(restored.record).toEqual(first);expect(restored.evidence?.rawXml).toBe(xml);expect(restored.evidence?.manifest.rawSha256).toBe(evidence.manifest.rawSha256);
   const csv=exposureCSV({...first,rows:first.rows.map(row=>({...row,name:'=IMPORTXML("x")'}))});
   expect(csv).toContain("'=IMPORTXML");expect(csv).toContain(evidence.manifest.rawSha256);expect(csv).toContain('portfolio_as_of');
 });
 it('rejects altered payloads and unsupported versions and preserves null assessment semantics',async()=>{
   const evidence=await frozen(),event=eventFromEvidence(evidence);
   const record=await investigate({event,portfolio:demoPortfolio,evidence:null,threshold:4,unavailableReason:'No published ShakeMap'});
   const bundle=await encodeBundle(record,null),plain=JSON.parse(await new Response(bundle.stream().pipeThrough(new DecompressionStream('gzip'))).text());
   plain.record.settings.threshold=5;await expect(decodeBundle(await gzip(plain))).rejects.toThrow('integrity');
   plain.schemaVersion=2;await expect(decodeBundle(await gzip(plain))).rejects.toThrow();
   const restored=await decodeBundle(bundle);expect(restored.record.summary).toMatchObject({meetingThreshold:null,belowThreshold:null,unknownIntensity:18,knownValueByCurrency:null});
 });
});
