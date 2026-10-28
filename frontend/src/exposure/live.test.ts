import { afterEach, expect, it, vi } from 'vitest';
import { discoverEarthquakes } from './live';
const feature = {id:'x',properties:{mag:null,place:'Public event',time:Date.parse('2026-01-01T00:00:00Z'),updated:Date.parse('2026-01-01T01:00:00Z'),ids:',x,alias-x,'},geometry:{coordinates:[.5,.5,8]}};
afterEach(()=>vi.unstubAllGlobals());
it('keeps valid discovery events and rejects invalid source records explicitly',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({type:'FeatureCollection',features:[feature,{id:'broken'}]}))));
 const feed=await discoverEarthquakes();expect(feed.events).toHaveLength(1);expect(feed.rejected).toBe(1);
 expect(feed.events[0].magnitude).toBeNull();
});
