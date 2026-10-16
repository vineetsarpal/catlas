import {describe,it,expect} from 'vitest';
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
