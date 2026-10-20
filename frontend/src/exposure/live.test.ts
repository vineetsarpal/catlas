import { afterEach, expect, it, vi } from 'vitest';
import { acquireEarthquake, discoverEarthquakes } from './live';
const feature = {id:'x',properties:{mag:null,place:'Public event',time:Date.parse('2026-01-01T00:00:00Z'),updated:Date.parse('2026-01-01T01:00:00Z'),ids:',x,alias-x,'},geometry:{coordinates:[.5,.5,8]}};
const xml='<shakemap_grid event_id="alias-x" shakemap_version="3" process_timestamp="2026-01-01T01:00:00"><event event_id="x"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>0 1 6\n1 1 8\n0 0 4\n1 0 6</grid_data></shakemap_grid>';
afterEach(()=>vi.unstubAllGlobals());
it('captures the selected active preferred product and exact event detail, without substituting unknown magnitude',async()=>{
 const product=(id:string,weight:number,status='UPDATE')=>({id,source:'us',code:'x',updateTime:Date.parse('2026-01-01T01:00:00Z'),status,preferredWeight:weight,contents:{'download/grid.xml':{url:`https://earthquake.usgs.gov/${id}.xml`}}});
 const detail=JSON.stringify({...feature,properties:{...feature.properties,products:{shakemap:[product('deleted',1000,'DELETE'),product('second',1),product('preferred',20)]}}});
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(detail)).mockResolvedValueOnce(new Response(xml));vi.stubGlobal('fetch',fetcher);
 const result=await acquireEarthquake('x');expect(result.evidence?.manifest).toMatchObject({productId:'preferred',magnitude:null,productVersion:'3',retrospective:false});
 expect(result.evidence?.rawEventJson).toBe(detail);expect(result.evidence?.manifest.eventDetailSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(fetcher.mock.calls[1][0]).toBe('https://earthquake.usgs.gov/preferred.xml');
 expect(JSON.stringify(fetcher.mock.calls)).not.toContain('portfolio');
});
it('keeps no-ShakeMap as an unavailable assessment and rejects invalid source records explicitly',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({type:'FeatureCollection',features:[feature,{id:'broken'}]}))).mockResolvedValueOnce(new Response(JSON.stringify(feature))));
 const feed=await discoverEarthquakes();expect(feed.events).toHaveLength(1);expect(feed.rejected).toBe(1);
 const capture=await acquireEarthquake('x');expect(capture.evidence).toBeNull();expect(capture.reason).toContain('not published');expect(capture.event.magnitude).toBeNull();
});
