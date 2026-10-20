import { describe, expect, it } from 'vitest';
import { cycloneFeatures, parseCyclones } from './feeds';
import { distanceKm } from './model';
const now=Date.parse('2026-10-19T22:00:00Z');
const feature=(suffix:string,geometry:unknown,adv='026')=>({type:'Feature',geometry,properties:{idp_source:`ep212026-${adv}_5day_${suffix}`,advisnum:adv,stormname:'Trudy',advdate:'200 PM MST Mon Oct 19 2026',idp_filedate:now-3600000,tau:0,maxwind:35}});
const collection=(features:unknown[])=>({type:'FeatureCollection',features});
const points=collection([feature('pts',{type:'Point',coordinates:[-107.9,19.3]})]);
const tracks=collection([feature('lin',{type:'LineString',coordinates:[[-107.9,19.3],[-109,20]]})]);
const cones=collection([feature('pgn',{type:'Polygon',coordinates:[[[-108,19],[-110,20],[-109,21],[-108,19]]]})]);
describe('monitor provider boundaries',()=>{
  it('only attaches cyclone geometry from the same storm and advisory',()=>{
    const current=parseCyclones(points,tracks,cones,now);
    expect(current.storms[0]).toMatchObject({advisory:'26',windKt:35,track:{type:'LineString'},cone:{type:'Polygon'}});
    expect(cycloneFeatures(current.storms).features).toHaveLength(3);
    const mismatched=structuredClone(tracks);mismatched.features[0]=feature('lin',{type:'LineString',coordinates:[[-107.9,19.3],[-109,20]]},'025');
    const result=parseCyclones(points,mismatched,cones,now);
    expect(result.storms[0].track).toBeNull();expect(result.warning).toContain('different advisory');
  });
  it('rejects stale, truncated, malformed and mismatched source records rather than reporting no storms',()=>{
    expect(()=>parseCyclones(points,tracks,cones,now+13*3600000)).toThrow('older than 12 hours');
    expect(()=>parseCyclones({...points,exceededTransferLimit:true},undefined,undefined,now)).toThrow('truncated');
    const invalid=feature('pts',{type:'Point',coordinates:[-107.9,19.3]});invalid.properties.advisnum='25';
    expect(()=>parseCyclones(collection([invalid]),undefined,undefined,now)).toThrow('advisory identifiers');
    expect(()=>parseCyclones(collection([feature('pts',{type:'Point',coordinates:[999,19]})]),undefined,undefined,now)).toThrow();
    expect(parseCyclones(collection([]),undefined,undefined,now)).toEqual({storms:[],warning:''});
  });
  it('retains current positions when geometry endpoints are unavailable',()=>{
    const result=parseCyclones(points,undefined,undefined,now);
    expect(result.storms).toHaveLength(1);expect(result.storms[0].cone).toBeNull();expect(result.warning).toBeTruthy();
  });
  it('computes proximity across the dateline without treating it as a hazard assessment',()=>{
    expect(distanceKm({latitude:0,longitude:179},{latitude:0,longitude:-179})).toBeCloseTo(222.39,1);
    expect(distanceKm({latitude:89,longitude:45},{latitude:89,longitude:45})).toBe(0);
  });
});
