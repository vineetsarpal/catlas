import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCwfisHotspots, loadCwfisIncidents, loadCwfisEstimates } from '../src/cwfis';
import { HazardService } from '../src/hazards';
import { fireSnapshotSchema, perimeterSnapshotSchema } from '@catlas/shared/hazards';

const now=Date.parse('2026-10-21T12:00:00Z');
const iso=(n:number)=>new Date(n).toISOString();
const collection=(features:unknown[],numberMatched=features.length)=>({type:'FeatureCollection',features,numberMatched,numberReturned:features.length});
const point={type:'Point',coordinates:[-120,55]};
const polygon={type:'Polygon',coordinates:[[[-121,54],[-119,54],[-119,56],[-121,54]]]};
const hotspot=(uid=1,patch:Record<string,unknown>={})=>({type:'Feature',id:'generated-and-unstable',geometry:point,properties:{uid,rep_date:iso(now-3600000),satellite:'N21',sensor:'VIIRS',...patch}});
const incident=(patch:Record<string,unknown>={})=>({type:'Feature',id:'generated-and-unstable',geometry:point,properties:{id:12,national_fire_id:'2026_BC_G001',agency_fire_id:'G001',agency_code:'BC',stage_of_control_status:'OC',percent_contained:-1,status_date:iso(now-86400000),record_start:iso(now-86400000),record_end:iso(now+86400000),...patch}});
const estimate=(uid=1,patch:Record<string,unknown>={})=>({type:'Feature',geometry:polygon,properties:{uid,lastdate:iso(now-3600000),...patch}});
const json=(value:unknown)=>new Response(JSON.stringify(value));

test('CWFIS hotspots paginate, use stable IDs and reject invalid positions without inventing confidence',async()=>{
  const urls:URL[]=[];
  const read=async(input:string)=>{
    const url=new URL(input);urls.push(url);
    return collection(url.searchParams.get('startIndex')==='0'?[hotspot(),{...hotspot(2),geometry:{type:'Point',coordinates:[999,55]}}]:[hotspot(3),hotspot(4,{rep_date:iso(now-25*3600000)}),hotspot(5,{rep_date:iso(now+1)})],5);
  };
  const value=await loadCwfisHotspots(read,now);
  assert.deepEqual(value.rows.map(r=>r.id),['cwfis:hotspot:1','cwfis:hotspot:3']);
  assert.equal(value.rows[0].confidence,null);assert.equal(value.rows[0].provider,'CWFIS');assert.equal(value.rejected,1);
  assert.equal(urls[1].searchParams.get('startIndex'),'2');
  assert.equal(urls[0].searchParams.get('srsName'),'CRS:84');
  assert.match(urls[0].searchParams.get('CQL_FILTER')!,/rep_date > .* AND rep_date <=/);
});

test('CWFIS incidents use current validity, national identity and actual reported containment only',async()=>{
  const value=await loadCwfisIncidents(async url=>{
    assert.match(new URL(url).searchParams.get('CQL_FILTER')!,/record_start <= .* AND record_end >=/);
    return collection([incident(),incident({id:13,record_start:iso(now-1000),percent_contained:25}),incident({id:14,national_fire_id:'old',record_end:iso(now-1)}),incident({id:15,national_fire_id:'future',record_start:iso(now+1)}),incident({id:16,national_fire_id:'invalid',record_start:null})]);
  },now);
  assert.equal(value.rows.length,1);assert.equal(value.rejected,1);
  assert.deepEqual(value.rows[0],{id:'cwfis:incident:2026_BC_G001',name:'BC G001',geometry:null,updatedAt:iso(now-86400000),containment:25,sourceUrl:'https://cwfis.cfs.nrcan.gc.ca/en/',provider:'CWFIS',evidence:'reported-incident',position:{longitude:-120,latitude:55},cwfis:{agency:'BC',status:'OC',recordStart:iso(now-1000),recordEnd:iso(now+86400000)}});
  const unknown=await loadCwfisIncidents(async()=>collection([incident()]),now);
  assert.equal(unknown.rows[0].containment,null);
});

test('CWFIS estimates are recent satellite boundaries with observation time distinct from publication time',async()=>{
  const value=await loadCwfisEstimates(async url=>{
    assert.equal(new URL(url).searchParams.get('typeNames'),'public:m3polygons');
    return collection([estimate(),estimate(2,{lastdate:iso(now-8*86400000)}),{...estimate(3),geometry:{type:'Point',coordinates:[-120,55]}},estimate(4,{lastdate:null})]);
  },now);
  assert.equal(value.rows.length,1);assert.equal(value.rejected,2);
  assert.equal(value.rows[0].evidence,'estimated-perimeter');assert.equal(value.rows[0].updatedAt,null);assert.equal(value.rows[0].containment,null);
  assert.equal(value.rows[0].cwfis?.lastDetectedAt,iso(now-3600000));assert.deepEqual(value.rows[0].geometry,polygon);
});

test('incomplete, repeated, changed and unbounded CWFIS collections fail rather than replacing evidence',async()=>{
  for(const mode of ['empty-page','repeat','changed','unknown-total','page-limit']) {
    let calls=0;
    await assert.rejects(loadCwfisHotspots(async()=>{
      calls++;
      if(mode==='empty-page')return collection(calls===1?[hotspot()]:[],2);
      if(mode==='repeat')return collection([hotspot()],2);
      if(mode==='changed')return collection([hotspot(calls)],calls===1?3:4);
      if(mode==='unknown-total')return {...collection([hotspot()]),numberMatched:'unknown'};
      return collection([hotspot(calls)],100000);
    },now));
    assert.ok(calls<=20);
  }
});

function mockFeeds(options:{down?:Set<string>;hotspots?:unknown[];incidents?:unknown[];estimates?:unknown[]}={}) {
  const calls:string[]=[];
  const fetcher:typeof fetch=async input=>{
    const url=new URL(String(input));const layer=url.searchParams.get('typeNames')?.split(':')[1];const source=layer??'NIFC';calls.push(source);
    if(options.down?.has(source))throw Error('outage');
    if(layer==='hotspots_24h')return json(collection(options.hotspots??[hotspot()]));
    if(layer==='cwfif_national_activefires')return json(collection(options.incidents??[incident()]));
    if(layer==='m3polygons')return json(collection(options.estimates??[estimate()]));
    return json({features:[{id:1,geometry:polygon,properties:{attr_UniqueFireIdentifier:'us-fire',poly_IncidentName:'US Fire'}}]});
  };
  return {calls,fetcher};
}

test('CWFIS operates without a FIRMS key and every provider has independent acquisition status',async()=>{
  const mock=mockFeeds();const service=new HazardService({now:()=>now,fetch:mock.fetcher});
  const fires=await service.fires(),perimeters=await service.perimeters();
  assert.equal(fires.rows.length,1);assert.equal(fires.stale,true);assert.equal(fires.sources?.find(s=>s.provider==='FIRMS')?.available,false);
  assert.equal(fires.sources?.find(s=>s.provider==='CWFIS hotspots')?.stale,false);
  assert.equal(perimeters.rows.length,3);assert.equal(perimeters.stale,false);
  assert.ok(fireSnapshotSchema.safeParse(fires).success);assert.ok(perimeterSnapshotSchema.safeParse(perimeters).success);
  await Promise.all([service.fires(),service.perimeters(),service.perimeters()]);assert.equal(mock.calls.length,4);
});

test('CWFIS failures retain only the failed dataset, preserve US evidence and expire old Canadian evidence',async()=>{
  let time=now;const down=new Set<string>();const mock=mockFeeds({down});
  const service=new HazardService({now:()=>time,fetch:mock.fetcher});
  await service.perimeters();await service.fires();
  down.add('cwfif_national_activefires');time+=31*60000;
  let value=await service.perimeters();assert.equal(value.rows.length,3);
  assert.equal(value.sources?.find(s=>s.provider==='CWFIS incidents')?.fetchedAt,iso(now));
  assert.equal(value.sources?.find(s=>s.provider==='NIFC')?.stale,false);assert.match(value.warning,/CWFIS incidents.*previous evidence retained/);
  down.add('m3polygons');down.add('hotspots_24h');time=now+8*86400000;
  value=await service.perimeters();assert.deepEqual(value.rows.map(r=>r.id),['us-fire']);
  assert.equal((await service.fires()).rows.length,0);
  down.clear();const recovered=await service.perimeters(); // Retry backoff still applies.
  assert.equal(recovered.stale,true);
});

test('a complete CWFIS refresh removes withdrawn incidents and recovers after provider failure',async()=>{
  let time=now;const options={down:new Set<string>(),incidents:[incident()]};const mock=mockFeeds(options);
  const service=new HazardService({now:()=>time,fetch:mock.fetcher});await service.perimeters();
  options.down.add('cwfif_national_activefires');time+=11*60000;assert.equal((await service.perimeters()).stale,true);
  options.down.clear();options.incidents=[];time+=61000;const result=await service.perimeters();
  assert.equal(result.stale,false);assert.equal(result.rows.some(row=>row.evidence==='reported-incident'),false);
});
