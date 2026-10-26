import { describe,expect,it } from 'vitest';
import type { FireDetection, FirePerimeter, WeatherAlert } from '@catlas/shared/hazards';
import type { Portfolio } from '../exposure/model';
import type { MonitorState } from './useMonitor';
import { attentionMonitorItems,distanceKm,isMonitorItemWatched,monitorItems,visibleMonitorItems } from './model';
const now=Date.parse('2026-10-20T12:00:00Z'),time=new Date(now).toISOString();
const portfolio:Portfolio={source:'test',asOf:'2026-10-20',synthetic:true,excludedRows:0,warnings:[],locations:[{id:'site',name:'Site',longitude:0,latitude:0,value:100,currency:'USD',region:'',businessLine:''}]};
const perimeter:FirePerimeter={id:'incident',name:'Fire',updatedAt:time,containment:null,sourceUrl:'https://example.com',geometry:{type:'Polygon',coordinates:[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]}};
const alert:WeatherAlert={id:'new',references:['old'],name:'Warning',event:'Tornado Warning',severity:'Extreme',certainty:'Observed',urgency:'Immediate',issuedAt:time,updatedAt:time,expiresAt:new Date(now+3600000).toISOString(),active:true,geometry:null,description:'Warning',sourceUrl:'https://example.com'};
const fire:FireDetection={id:'detection',longitude:0,latitude:0,detectedAt:time,source:'FIRMS',confidence:80};
function state(fires:FireDetection[]=[fire],perimeters:FirePerimeter[]=[perimeter],alerts:WeatherAlert[]=[alert]):MonitorState {
  // The model consumes only these fields; fixture explicitly leaves hook actions out.
  return {prefs:{earthquakes:false,cyclones:false,locations:false,fires:true,perimeters:true,alerts:true,fireDistanceKm:10,nearPortfolio:false,watchedOnly:false,watchlist:[]},now,vessels:{rows:[],portfolio:[]},fires:{data:{rows:fires}},perimeters:{data:{rows:perimeters}},alerts:{data:{rows:alerts}}} as unknown as MonitorState;
}
describe('Monitor hazard attention',()=>{
  it('expires cached hotspots and cancelled/expired alerts against the current time',()=>{
    const current=state([fire,{...fire,id:'old',detectedAt:new Date(now-24*3600000).toISOString()},{...fire,id:'future',detectedAt:new Date(now+1).toISOString()}],[],[alert,{...alert,id:'expired',expiresAt:time},{...alert,id:'cancelled',active:false}]);
    const items=monitorItems(current,portfolio);
    expect(items.filter(i=>i.kind==='fire')[0].fireDetections?.map(f=>f.id)).toEqual(['detection']);
    expect(items.filter(i=>i.kind==='alert').map(i=>i.alert?.id)).toEqual(['new']);
    current.now+=24*3600000+1;
    expect(monitorItems(current,portfolio)).toEqual([]);
  });
  it('keeps acquisition relevance independent from map visibility and rejects absent map positions',()=>{
    const current=state(),items=monitorItems(current,portfolio);
    expect(items.find(i=>i.kind==='fire')?.nearby).toBe(1);
    expect(items.find(i=>i.kind==='alert')).toMatchObject({hasPosition:false,relevance:{screeningUnavailable:true}});
    expect(attentionMonitorItems(items,current).map(i=>i.kind)).toEqual(['perimeter','fire','alert']);
    expect(visibleMonitorItems(items,current).map(i=>i.kind)).toEqual(['fire','perimeter']);
    current.prefs.fires=false;
    expect(monitorItems(current,portfolio).some(i=>i.kind==='fire')).toBe(false);
  });
  it('groups nearby detections per site without attributing satellite detections to an incident',()=>{
    const current=state([fire,{...fire,id:'second'}]),items=monitorItems(current,portfolio);
    expect(items.filter(i=>i.kind==='fire'&&!i.mapOnly)).toHaveLength(1);
    expect(items.find(i=>i.kind==='fire')).toMatchObject({key:'fire:location:site',fireDetections:[fire,{...fire,id:'second'}],nearby:1,relevance:{totals:[{currency:'USD',value:100}]}});
  });
  it('draws raw hotspot coordinates rather than portfolio grouping positions',()=>{
    const current=state([{...fire,longitude:0.05},{...fire,id:'distant',longitude:50}],[],[]);
    const items=monitorItems(current,portfolio);
    expect(visibleMonitorItems(items,current).map(i=>i.longitude)).toEqual([0.05,50]);
    expect(attentionMonitorItems(items,current)).toHaveLength(1);
    current.prefs.nearPortfolio=true;
    expect(visibleMonitorItems(items,current).map(i=>i.longitude)).toEqual([0.05]);
    current.prefs.watchedOnly=true;current.prefs.watchlist=[{key:'fire:location:site',name:'Site fire detections'}];
    expect(visibleMonitorItems(items,current).map(i=>i.longitude)).toEqual([0.05]);
    current.prefs.nearPortfolio=false;current.prefs.watchlist=[{key:'fire:detection:distant',name:'Distant detection'}];
    expect(visibleMonitorItems(items,current).map(i=>i.longitude)).toEqual([50]);
  });
  it('matches brute-force proximity at cell boundaries, across the dateline and near both poles',()=>{
    const positions=[[179.99,0],[-179.99,0],[0,0],[0.99,0.99],[1.01,1.01],[45,89.99],[-135,89.99],[45,-89.99],[-135,-89.99],[180,90],[-180,-90]];
    const detections=positions.map(([longitude,latitude],i)=>({...fire,id:String(i),longitude,latitude}));
    const locations=positions.map(([longitude,latitude],i)=>({...portfolio.locations[0],id:String(i),longitude,latitude}));
    for(const radius of [0,10,100]) {
      const current=state(detections,[],[]);current.prefs.fireDistanceKm=radius;
      const items=monitorItems(current,{...portfolio,locations});
      for(const site of locations) {
        const expected=detections.filter(detection=>distanceKm(detection,site)<=radius).map(d=>d.id).sort();
        const group=items.find(item=>item.key===`fire:location:${site.id}`);
        expect(group?.fireDetections?.map(d=>d.id).sort()??[]).toEqual(expected);
      }
      for(const item of items.filter(item=>item.mapOnly))expect(item.nearby).toBe(locations.filter(site=>distanceKm(item.fire!,site)<=radius).length);
    }
  });
  it('screens Canadian incident points by proximity and estimates by polygon without inventing containment',()=>{
    const incident:FirePerimeter={...perimeter,id:'cwfis:incident:BC1',provider:'CWFIS',evidence:'reported-incident',geometry:null,position:{longitude:0,latitude:0},cwfis:{agency:'BC',status:'OC',recordStart:time,recordEnd:new Date(now+3600000).toISOString()}};
    const estimate:FirePerimeter={...perimeter,id:'cwfis:estimate:1',provider:'CWFIS',evidence:'estimated-perimeter',updatedAt:null,cwfis:{agency:'',status:'',lastDetectedAt:time}};
    const current=state([], [incident,estimate], []),items=monitorItems(current,portfolio);
    expect(items[0]).toMatchObject({hasPosition:true,longitude:0,latitude:0,relevance:{inside:0,nearby:1,screeningUnavailable:false,reasons:['Near reported fire location · boundary not supplied']}});
    expect(items[1]).toMatchObject({relevance:{inside:1,reasons:['Inside estimated fire area']}});
    const canadianPortfolio={...portfolio,locations:[{...portfolio.locations[0],currency:'CAD',value:2500000}]};
    const canadianItems=monitorItems(current,canadianPortfolio);
    expect(canadianItems.every(item=>item.relevance?.totals.length===1&&item.relevance.totals[0].currency==='CAD'&&item.relevance.totals[0].value===2500000)).toBe(true);
    expect(visibleMonitorItems(items,current)).toHaveLength(2);
    current.prefs.nearPortfolio=true;
    expect(attentionMonitorItems(items,current)).toHaveLength(2);
    current.now+=2*3600000;
    expect(monitorItems(current,portfolio).map(item=>item.perimeter?.id)).toEqual(['cwfis:estimate:1']);
    current.now=now+7*86400000;
    expect(monitorItems(current,portfolio)).toEqual([]);
  });
  it('keeps Attention and Locations available when the map is restricted to watchlist items',()=>{
    const current=state();current.prefs.locations=true;
    const items=monitorItems(current,portfolio),attention=attentionMonitorItems(items,current);
    current.prefs.watchedOnly=true;
    expect(visibleMonitorItems(items,current)).toEqual([]);
    expect(attentionMonitorItems(items,current)).toEqual(attention);
    expect(attentionMonitorItems(items,current).some(item=>item.kind==='location')).toBe(true);
    current.prefs.watchlist=[{key:'perimeter:incident',name:'Fire'}];
    expect(visibleMonitorItems(items,current).map(item=>item.key)).toEqual(['perimeter:incident']);
    expect(attentionMonitorItems(items,current)).toEqual(attention);
  });
  it('follows alert identity references and preserves unavailable screening under portfolio filtering',()=>{
    const current=state(),items=monitorItems(current,portfolio),warning=items.find(i=>i.kind==='alert')!;
    current.prefs.watchlist=[{key:'alert:old',name:'Original warning'}];
    current.prefs.watchedOnly=true;current.prefs.nearPortfolio=true;
    expect(isMonitorItemWatched(warning,current.prefs.watchlist)).toBe(true);
    expect(attentionMonitorItems(items,current)).toContain(warning);
    expect(isMonitorItemWatched(warning,[{key:'alert:unrelated',name:'Other warning'}])).toBe(false);
  });
});
