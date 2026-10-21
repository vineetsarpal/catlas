import test from 'node:test';
import assert from 'node:assert/strict';
import { HazardService } from '../src/hazards';
import { createApp } from '../src/app';

const start=Date.parse('2026-10-20T12:00:00Z');
const json=(value:unknown)=>new Response(JSON.stringify(value));
// Existing provider tests isolate US sources; Canadian combinations have their own tests.
function nwsService(options:ConstructorParameters<typeof HazardService>[0]={}) {
  const fetcher=options.fetch??fetch;
  return new HazardService({...options,fetch:async(input,init)=>String(input).startsWith('https://api.weather.gc.ca/')?json({features:[],numberMatched:0}):/https:\/\/(?:cwfis\.cfs|geoserver\.cwfif)\.nrcan\.gc\.ca\//.test(String(input))?json({type:'FeatureCollection',features:[],numberMatched:0}):fetcher(input,init)});
}

const polygon={type:'Polygon',coordinates:[[[-80,40],[-79,40],[-79,41],[-80,40]]]};
const perimeter=(id:number)=>({id,properties:{OBJECTID:id,attr_UniqueFireIdentifier:`fire-${id}`,poly_IncidentName:'Example',poly_DateCurrent:start-48*3600_000},geometry:polygon});
const alert=(id:string,extra:Record<string,unknown>={},g:unknown=polygon)=>({id:`https://api.weather.gov/alerts/${id}`,geometry:g,properties:{id,event:'Tornado Warning',headline:'Tornado warning',status:'Actual',messageType:'Alert',severity:'Extreme',certainty:'Observed',urgency:'Immediate',sent:new Date(start-1000).toISOString(),effective:new Date(start-1000).toISOString(),expires:new Date(start+60_000).toISOString(),description:'Test',...extra}});

test('unconfigured FIRMS makes no upstream requests',async()=>{
  const service=nwsService({now:()=>start,fetch:async()=>{throw Error('must not fetch');}});
  const value=await service.fires();assert.equal(value.stale,true);assert.match(value.warning,/not configured/);assert.equal(value.rows.length,0);
});

test('FIRMS caches, marks partial coverage and expires detections even during outages',async()=>{
  let now=start,calls=0,fail=false;
  const csv='latitude,longitude,acq_date,acq_time,confidence\n40,-80,2026-10-19,1201,n\n40,-81,2026-10-20,1100,h\n';
  const service=nwsService({firmsKey:'secret',now:()=>now,fetch:async input=>{calls++;if(fail||String(input).includes('NOAA21'))throw Error('down');return new Response(csv);}});
  let value=await service.fires();assert.equal(value.rows.length,2);assert.equal(value.stale,true);assert.match(value.warning,/Partial/);assert.equal(calls,4);
  now+=120_000;value=await service.fires();assert.equal(calls,4);assert.equal(value.rows.length,1);
  fail=true;now=start+25*3600_000;value=await service.fires();assert.equal(value.rows.length,0);assert.equal(value.stale,true);assert.equal(value.fetchedAt,new Date(start).toISOString());
});

test('perimeters request unsimplified geometry and paginate all pages',async()=>{
  const urls:string[]=[];
  const service=nwsService({now:()=>start,fetch:async input=>{const url=String(input);urls.push(url);return json({features:[perimeter(url.includes('resultOffset=0')?1:2)],exceededTransferLimit:url.includes('resultOffset=0')});}});
  const value=await service.perimeters();assert.equal(value.rows.length,2);assert.equal(urls.length,2);assert.ok(urls.every(url=>!url.includes('maxAllowableOffset')));assert.equal(value.rows[0].updatedAt,new Date(start-48*3600_000).toISOString());assert.deepEqual(value.rows[0].geometry,polygon);
});

test('truncated perimeter pagination retains previous complete evidence',async()=>{
  let now=start,truncated=false,calls=0;
  const service=nwsService({now:()=>now,fetch:async()=>{calls++;return json({features:truncated?[]:[perimeter(1)],exceededTransferLimit:truncated});}});
  await service.perimeters();truncated=true;now+=6*60_000;const value=await service.perimeters();assert.equal(value.stale,true);assert.equal(value.rows.length,1);assert.equal(calls,2);
});

test('NWS resolves complete official zone geometry and preserves unresolved alerts',async()=>{
  const zone='https://api.weather.gov/zones/forecast/CAZ001';const requested:string[]=[];
  const service=nwsService({now:()=>start,fetch:async input=>{const url=String(input);requested.push(url);if(url===zone)return json({geometry:polygon});return json({features:[alert('resolved',{affectedZones:[zone]},null),alert('unresolved',{affectedZones:['https://evil.example/zone']},null),alert('ignored',{event:'Small Craft Advisory'})]});}});
  const value=await service.alerts();assert.equal(value.rows.length,2);assert.equal(value.rows.find(r=>r.id==='resolved')?.geometry?.type,'MultiPolygon');assert.equal(value.rows.find(r=>r.id==='unresolved')?.geometry,null);assert.match(value.warning,/screening unavailable/);assert.equal(requested.length,2);
});

test('NWS update/cancellation chain supersedes earlier alert; expiry applies while cached',async()=>{
  let now=start;
  const service=nwsService({now:()=>now,fetch:async()=>json({features:[alert('old'),alert('new',{references:[{identifier:'old'}]}),alert('cancel',{messageType:'Cancel',references:[{identifier:'new'}]}),alert('expire')]})});
  let value=await service.alerts();assert.deepEqual(value.rows.map(r=>r.id).sort(),['cancel','expire']);assert.equal(value.rows.find(r=>r.id==='cancel')?.active,false);assert.equal(value.rows.find(r=>r.id==='expire')?.active,true);
  now+=2*60_000;value=await service.alerts();assert.ok(value.rows.every(r=>!r.active));
});

test('NWS failed refresh retains evidence with stale state',async()=>{
  let now=start,down=false;const service=nwsService({now:()=>now,fetch:async()=>{if(down)throw Error('offline');return json({features:[alert('one')]});}});
  await service.alerts();down=true;now+=6*60_000;const value=await service.alerts();assert.equal(value.stale,true);assert.equal(value.rows.length,1);assert.equal(value.rows[0].active,false);
});

test('hazard routes preserve localhost access checks',async()=>{
  const app=createApp({hazards:nwsService({now:()=>start})});
  try{assert.equal((await app.inject({url:'/api/monitor/fires',headers:{host:'localhost:3001'}})).statusCode,200);assert.equal((await app.inject({url:'/api/monitor/fires',headers:{host:'evil.example'}})).statusCode,403);}finally{await app.close();}
});

test('multiple current perimeter parts of one incident are all retained for screening',async()=>{
  const first=perimeter(1),second={...perimeter(2),properties:{...perimeter(2).properties,attr_UniqueFireIdentifier:'fire-1'}};
  const service=nwsService({now:()=>start,fetch:async()=>json({features:[first,second]})});
  const value=await service.perimeters();assert.equal(value.rows.length,1);assert.equal(value.rows[0].geometry?.type,'MultiPolygon');assert.equal(value.rows[0].geometry?.coordinates.length,2);
});

test('concurrent hazard refreshes share one provider pass',async()=>{
  let calls=0;const service=nwsService({now:()=>start,fetch:async()=>{calls++;return json({features:[]});}});
  await Promise.all([service.perimeters(),service.perimeters(),service.perimeters()]);assert.equal(calls,1);
});

test('NWS follows official pagination forms and canonicalizes reference URL identifiers',async()=>{
  let calls=0;
  const service=nwsService({now:()=>start,fetch:async input=>{calls++;if(calls===1){assert.equal(new URL(String(input)).pathname,'/alerts');return json({features:[alert('urn:oid:old')],pagination:{next:'https://api.weather.gov/alerts/active?cursor=next'}});}return json({features:[alert('urn:oid:new',{references:[{'@id':'https://api.weather.gov/alerts/urn:oid:old'}],parameters:{expiredReferences:['sender,urn:oid:oldest,2026-10-20T00:00:00Z']}})]});}});
  const value=await service.alerts();assert.equal(calls,2);assert.equal(value.rows.length,1);assert.equal(value.rows[0].id,'urn:oid:new');assert.deepEqual(value.rows[0].references,['urn:oid:old','urn:oid:oldest']);
});

test('CAP message expiration ends active evidence even when event ends later',async()=>{
  const service=nwsService({now:()=>start,fetch:async()=>json({features:[alert('expired',{expires:new Date(start-1000).toISOString(),ends:new Date(start+3600_000).toISOString()})]})});
  const value=await service.alerts();assert.equal(value.rows[0].active,false);assert.equal(value.rows[0].expiresAt,new Date(start-1000).toISOString());
});

test('latest update and cancellation retain transitive aliases after intermediate rows are removed',async()=>{
  for(const messageType of ['Update','Cancel']){
    const service=nwsService({now:()=>start,fetch:async()=>json({features:[alert('A'),alert('B',{references:[{identifier:'A'}]}),alert('C',{messageType,references:[{identifier:'B'}]})]})});
    const value=await service.alerts();assert.equal(value.rows.length,1);assert.equal(value.rows[0].id,'C');assert.deepEqual(value.rows[0].references,['B','A']);assert.equal(value.rows[0].active,messageType!=='Cancel');
  }
});

test('malformed cyclic alert aliases terminate while preserving reachable predecessor aliases',async()=>{
  const service=nwsService({now:()=>start,fetch:async()=>json({features:[alert('A',{references:[{identifier:'B'}]}),alert('B',{references:[{identifier:'A'}]}),alert('C',{references:[{identifier:'B'}]})]})});
  const value=await service.alerts();assert.equal(value.rows.length,1);assert.deepEqual(value.rows[0].references,['B','A']);
});
