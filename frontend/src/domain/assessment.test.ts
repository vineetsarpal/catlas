import {describe,it,expect} from 'vitest';
import {eventInputSchema,contractInputSchema} from './types';
import {assess,distanceKm,matrixCell,triggerPolygon} from './assessment';
import {mainContract,ridgecrest,manifest} from '../data/fixtures';
import fs from 'node:fs';
import crypto from 'node:crypto';
describe('two-area contractual recovery',()=>{
 it('reproduces independently specified Ridgecrest contributions',()=>{const a=assess(ridgecrest,mainContract);expect(a.status).toBe('Trigger met');expect(a.amount).toBe(6000000);expect(a.areas.map(a=>a.contribution)).toEqual([4500000,1500000]);expect(a.areas[0].distanceKm).toBeCloseTo(18.298,3);expect(a.areas[1].distanceKm).toBeCloseTo(68.107,3);});
 it.each([[6.499999,25,0],[6.5,25,.5],[6.999999,25,.5],[7,25,.75],[7.499999,25,.75],[7.5,25,1],[7.1,25.000001,.375],[7.1,100,.375],[7.1,100.000001,0]])('raw magnitude %s / exact rule distance %s → %s',(m,d,rate)=>expect(matrixCell(m,d).rate).toBe(rate));
 it('applies the treaty cap after summing',()=>expect(assess(ridgecrest,{...mainContract,eventCap:5000000}).amount).toBe(5000000));
 it('uses occurrence at inception included and expiry excluded',()=>{expect(assess({...ridgecrest,occurredAt:mainContract.inception},mainContract).amount).toBe(6000000);expect(assess({...ridgecrest,occurredAt:mainContract.expiry},mainContract).status).toBe('Outside coverage');});
 it('does not assert zero for missing or unsupported required inputs',()=>{expect(assess({...ridgecrest,magnitudeType:'mww',magnitude:4},mainContract).amount).toBeNull();expect(assess({...ridgecrest,magnitude:4},{...mainContract,inception:undefined,expiry:undefined}).status).toBe('Needs review');});
 it('derives geodesic polygons from fixed references',()=>{const a=mainContract.areas[0],ring=triggerPolygon(a,100).coordinates[0];expect(ring.length).toBeGreaterThan(100);for(const [longitude,latitude] of ring)expect(distanceKm(a,{longitude,latitude})).toBeCloseTo(100,8);});
});
describe('genuine captured evidence',()=>{
 it('matches every byte digest and selected summary input',()=>{for(const file of manifest.files){const bytes=fs.readFileSync(`public/evidence/${file.file}`);expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);}const j=JSON.parse(fs.readFileSync('public/evidence/ridgecrest-detail.geojson','utf8'));expect(j.properties.mag).toBe(ridgecrest.magnitude);expect(j.properties.magType).toBe(ridgecrest.magnitudeType);expect(new Date(j.properties.time).toISOString()).toBe(ridgecrest.occurredAt);expect(j.geometry.coordinates.slice(0,2)).toEqual([ridgecrest.longitude,ridgecrest.latitude]);const origin=j.properties.products.origin.reduce((a:any,b:any)=>a.preferredWeight>b.preferredWeight?a:b);expect(origin.id).toBe(manifest.selectedProductId);expect(origin.properties['quakeml-origin-publicid']).toBe(manifest.selectedOriginId);expect(origin.properties['quakeml-magnitude-publicid']).toBe(manifest.selectedMagnitudeId);});
});

describe('zero, incomplete and raw boundary semantics (CAT-15)',()=>{
 it('high-threshold import establishes a complete zero',()=>{const result=assess(ridgecrest,{...mainContract,minimumMagnitude:7.5});expect(result.status).toBe('Not triggered');expect(result.amount).toBe(0);expect(result.areas.map(a=>a.rate)).toEqual([0,0]);expect(result.knownFailures).toContain('Raw mw magnitude 7.1 is below the minimum 7.5.');});
 it('missing both dates remains null and reports both omissions',()=>{const result=assess(ridgecrest,{...mainContract,inception:undefined,expiry:undefined});expect(result.status).toBe('Needs review');expect(result.amount).toBeNull();expect(result.uncappedSum).toBeNull();expect(result.exceptions.some(r=>r.startsWith('Contract inception:'))).toBe(true);expect(result.exceptions.some(r=>r.startsWith('Contract expiry:'))).toBe(true);});
 it('retains known low magnitude separately from missing dates',()=>{const result=assess({...ridgecrest,magnitude:6.4},{...mainContract,inception:undefined,expiry:undefined});expect(result.status).toBe('Needs review');expect(result.amount).toBeNull();expect(result.knownFailures).toContain('Raw mw magnitude 6.4 is below the minimum 6.5.');expect(result.exceptions).toHaveLength(2);});
 it('retains known coverage failure despite unsupported magnitude type',()=>{const result=assess({...ridgecrest,magnitudeType:'mb',occurredAt:mainContract.expiry},mainContract);expect(result.status).toBe('Needs review');expect(result.amount).toBeNull();expect(result.knownFailures).toContain('Occurrence is outside the UTC coverage interval.');expect(result.exceptions.some(r=>r.startsWith('Event magnitudeType:'))).toBe(true);});
 it.each(['magnitude','magnitudeType','latitude','longitude','occurredAt','evidenceVersion'] as const)('missing %s takes precedence over a known coverage failure',field=>{const result=assess({...ridgecrest,occurredAt:mainContract.expiry,[field]:undefined},mainContract);expect(result.status).toBe('Needs review');expect(result.amount).toBeNull();});
 it('retains distance failures even with missing dates',()=>{const result=assess({...ridgecrest,latitude:0,longitude:0},{...mainContract,inception:undefined,expiry:undefined});expect(result.status).toBe('Needs review');expect(result.knownFailures.filter(r=>r.includes('100 km'))).toHaveLength(2);expect(result.amount).toBeNull();});
 it('complete distant event establishes Not triggered zero',()=>{const result=assess({...ridgecrest,latitude:0,longitude:0},mainContract);expect(result.status).toBe('Not triggered');expect(result.amount).toBe(0);expect(result.areas.map(a=>a.band)).toEqual(['outside','outside']);});
 it.each([
 [6.499999999,0,0],[6.5,.5,.25],[6.500000001,.5,.25],
 [6.999999999,.5,.25],[7,.75,.375],[7.000000001,.75,.375],
 [7.499999999,.75,.375],[7.5,1,.5],[7.500000001,1,.5],
 ])('inclusive raw magnitude %s gives inner %s / outer %s',(m,inner,outer)=>{expect(matrixCell(m,25).rate).toBe(inner);expect(matrixCell(m,100).rate).toBe(outer);});
 it.each([[24.999999999,'inner',.75],[25,'inner',.75],[25.000000001,'outer',.375],[99.999999999,'outer',.375],[100,'outer',.375],[100.000000001,'outside',0]])('exclusive raw distance %s gives %s/%s',(d,band,rate)=>{expect(matrixCell(7.1,d)).toMatchObject({band,rate});});
 it('does not use rounded labels as decision inputs',()=>{expect((6.999999999).toFixed(1)).toBe('7.0');expect(matrixCell(6.999999999,25).rate).toBe(.5);expect((25.000000001).toFixed(3)).toBe('25.000');expect(matrixCell(7.1,25.000000001).rate).toBe(.375);});
 it.each([
 ['2018-12-31T23:59:59.999Z','Outside coverage',0],
 ['2019-01-01T00:00:00.000Z','Trigger met',6000000],
 ['2019-01-01T00:00:00.001Z','Trigger met',6000000],
 ['2019-12-31T23:59:59.999Z','Trigger met',6000000],
 ['2020-01-01T00:00:00.000Z','Outside coverage',0],
 ['2020-01-01T00:00:00.001Z','Outside coverage',0],
 ])('UTC occurrence %s gives %s/%s',(occurredAt,status,amount)=>{const result=assess({...ridgecrest,occurredAt},mainContract);expect(result.status).toBe(status);expect(result.amount).toBe(amount);});
 it('sums first then applies a cap without changing contributions',()=>{const result=assess(ridgecrest,{...mainContract,eventCap:5000000});expect(result.areas.map(a=>a.contribution)).toEqual([4500000,1500000]);expect(result.uncappedSum).toBe(6000000);expect(result.amount).toBe(5000000);});
 it('invalid coverage ordering or invalid minimum cannot assert a zero',()=>{expect(assess(ridgecrest,{...mainContract,inception:mainContract.expiry,expiry:mainContract.inception}).amount).toBeNull();expect(assess(ridgecrest,{...mainContract,minimumMagnitude:-1}).amount).toBeNull();});
});

describe('raw evaluation snapshot schemas',()=>{
 it('accepts missing calculation fields and unsupported magnitude types without converting them',()=>{const event=eventInputSchema.parse({...ridgecrest,magnitudeType:'mb',occurredAt:null});expect(event.magnitudeType).toBe('mb');expect(event.occurredAt).toBeNull();const contract=contractInputSchema.parse({...mainContract,inception:undefined,expiry:null});expect(contract.inception).toBeUndefined();expect(contract.expiry).toBeNull();expect(assess(event,contract).amount).toBeNull();});
});

it('missing allocation does not erase independently known distance failures',()=>{const result=assess({...ridgecrest,latitude:0,longitude:0},{...mainContract,areas:mainContract.areas.map(a=>({...a,allocation:undefined}))});expect(result.amount).toBeNull();expect(result.knownFailures.filter(r=>r.includes('100 km'))).toHaveLength(2);expect(contractInputSchema.safeParse({...mainContract,areas:mainContract.areas.map(a=>({...a,allocation:undefined}))}).success).toBe(true);});
