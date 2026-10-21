import test from 'node:test';
import assert from 'node:assert/strict';
import { HazardService } from '../src/hazards';
import { ECCC_ALERT_ITEMS, loadEcccAlerts, parseEcccAlert } from '../src/eccc-alerts';

const now=Date.parse('2026-10-21T16:00:00Z');
const polygon={type:'Polygon',coordinates:[[[-80,43],[-79,43],[-79,44],[-80,43]]]};
const json=(value:unknown)=>Response.json(value);
function feature(id='bulletin_fea1-1',patch:Record<string,unknown>={},geometry:unknown=polygon) {
  return {id,geometry,properties:{alert_type:'advisory',alert_name_en:'frost advisory',alert_name_fr:'avis de gel',alert_text_en:'Frost expected tonight.',alert_text_fr:'Gel prévu cette nuit.',publication_datetime:'2026-10-21T14:00:00Z',expiration_datetime:'2026-10-21T17:00:00Z',validity_datetime:'2026-10-22T06:00:00Z',event_end_datetime:'2026-10-22T13:00:00Z',feature_name_en:'Niagara Region',province:'ON',feature_id:'fea1-1',status_en:'continued',risk_colour_en:'yellow',impact_en:'Moderate',confidence_en:'High',...patch}};
}
const collection=(features:unknown[],links:unknown[]=[])=>({features,links,numberMatched:features.length});
const nwsFeature=()=>({id:'https://api.weather.gov/alerts/bulletin_fea1-1',geometry:polygon,properties:{id:'bulletin_fea1-1',event:'Flood Warning',headline:'US flood warning',status:'Actual',messageType:'Alert',severity:'Severe',certainty:'Observed',urgency:'Immediate',sent:'2026-10-21T14:00:00Z',effective:'2026-10-21T14:00:00Z',expires:'2026-10-21T18:00:00Z',description:'US alert'}});

test('ECCC retains native source fields, future validity, bilingual text and area-specific identity',()=>{
  const alert=parseEcccAlert(feature())!;
  assert.equal(alert.id,'eccc:bulletin_fea1-1');assert.equal(alert.provider,'ECCC');assert.equal(alert.active,true);
  assert.match(alert.name,/Niagara Region, ON/);assert.equal(alert.severity,'Not supplied');
  assert.equal(alert.expiresAt,'2026-10-21T17:00:00.000Z');
  assert.deepEqual(alert.eccc,{area:'Niagara Region',province:'ON',alertType:'advisory',status:'continued',riskColour:'yellow',impact:'Moderate',confidence:'High',validAt:'2026-10-22T06:00:00.000Z',eventEndAt:'2026-10-22T13:00:00.000Z',nameFr:'avis de gel',descriptionFr:'Gel prévu cette nuit.'});
  assert.equal(alert.sourceUrl,`${ECCC_ALERT_ITEMS}/bulletin_fea1-1?f=html`);
  assert.equal(parseEcccAlert(feature('another_bulletin_fea1-1'))?.references.length,0);
});

test('ended alerts are inactive, unknown status/expiry is rejected and missing geometry is unscreened',()=>{
  assert.equal(parseEcccAlert(feature('ended',{status_en:'ended'}))?.active,false);
  assert.equal(parseEcccAlert(feature('unknown',{status_en:'unrecognized'})),null);
  assert.equal(parseEcccAlert(feature('expiry',{expiration_datetime:null})),null);
  assert.equal(parseEcccAlert(feature('missing',{},null))?.geometry,null);
  assert.equal(parseEcccAlert(feature('invalid',{}, {type:'Polygon',coordinates:[[[0,0],[1,1]]]}))?.geometry,null);
});

test('ECCC reads complete official pagination, prefers newer repeated identities and reports rejected evidence',async()=>{
  const urls:string[]=[];
  const result=await loadEcccAlerts(async url=>{
    urls.push(url);
    if(urls.length===1)return {...collection([feature()], [{rel:'next',href:`${ECCC_ALERT_ITEMS}?offset=1&limit=1000`}]),numberMatched:3};
    return {...collection([feature('bulletin_fea1-1',{publication_datetime:'2026-10-21T15:00:00Z',risk_colour_en:'orange'}),feature('bad',{expiration_datetime:null})]),numberMatched:3};
  });
  assert.equal(urls.length,2);assert.ok(urls[1].includes('f=json'));
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].eccc?.riskColour,'orange');assert.equal(result.rejected,1);
});

test('ECCC rejects external, cyclic, truncated and empty-continuation pagination',async()=>{
  for(const next of ['https://evil.example/alerts',`${ECCC_ALERT_ITEMS}?f=json&limit=1000`]) {
    let calls=0;
    await assert.rejects(loadEcccAlerts(async()=>{calls++;return collection([feature()],[{rel:'next',href:next}]);}));
    assert.equal(calls,1);
  }
  await assert.rejects(loadEcccAlerts(async()=>({...collection([feature()]),numberMatched:2})),/Truncated/);
  await assert.rejects(loadEcccAlerts(async()=>collection([],[{rel:'next',href:`${ECCC_ALERT_ITEMS}?offset=1`} ])),/Empty/);
});

test('combined alerts keep provider caches independent and expire stale Canadian observations during an outage',async()=>{
  let time=now,canadaDown=false,usDown=false,canadaCalls=0,usCalls=0;
  const service=new HazardService({now:()=>time,fetch:async input=>{
    if(String(input).startsWith(ECCC_ALERT_ITEMS)){canadaCalls++;if(canadaDown)throw Error('Canada unavailable');return json(collection([feature()]));}
    usCalls++;if(usDown)throw Error('US unavailable');return json({features:[nwsFeature()]});
  }});
  let result=await service.alerts();
  assert.equal(result.rows.length,2);assert.equal(result.stale,false);assert.equal(new Set(result.rows.map(row=>row.id)).size,2);
  await service.alerts();assert.equal(canadaCalls,1);assert.equal(usCalls,1);
  canadaDown=true;time+=61_000;result=await service.alerts();
  assert.equal(result.rows.length,2);assert.match(result.warning,/ECCC:/);
  assert.equal(result.sources?.find(source=>source.provider==='NWS')?.stale,false);
  assert.equal(result.sources?.find(source=>source.provider==='ECCC')?.fetchedAt,new Date(now).toISOString());
  time=Date.parse('2026-10-21T17:01:00Z');result=await service.alerts();
  assert.equal(result.rows.find(row=>row.provider==='ECCC')?.active,false);
  assert.equal(result.rows.find(row=>row.provider==='NWS')?.active,true);
  canadaDown=false;usDown=true;time+=61_000;result=await service.alerts();
  assert.equal(result.sources?.find(source=>source.provider==='ECCC')?.stale,false);
  assert.equal(result.sources?.find(source=>source.provider==='NWS')?.stale,true);
});

test('one unavailable provider does not discard another provider, and incomplete pages retain prior Canadian evidence',async()=>{
  let time=now,truncated=false;
  const service=new HazardService({now:()=>time,fetch:async input=>{
    if(!String(input).startsWith(ECCC_ALERT_ITEMS))throw Error('NWS down');
    return json({...collection([feature()]),numberMatched:truncated?2:1});
  }});
  let result=await service.alerts();assert.equal(result.rows.length,1);assert.match(result.warning,/NWS:/);
  time+=61_000;truncated=true;result=await service.alerts();assert.equal(result.rows.length,1);
  assert.equal(result.sources?.find(source=>source.provider==='ECCC')?.stale,true);
  assert.equal(result.sources?.find(source=>source.provider==='ECCC')?.fetchedAt,new Date(now).toISOString());
});
