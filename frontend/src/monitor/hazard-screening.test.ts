import { describe,expect,it } from 'vitest';
import type { HazardGeometry } from '@catlas/shared/hazards';
import type { InsuredLocation } from '../exposure/model';
import { distanceToGeometryKm, geometryContains, locationRelevance, screenGeometry } from './hazard-screening';
const square=(left:number,bottom:number,right:number,top:number):[number,number][]=>[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]];
const geometry:HazardGeometry={type:'Polygon',coordinates:[square(-2,-2,2,2),square(-1,-1,1,1)]};
const point=(longitude:number,latitude:number)=>({longitude,latitude});
const site=(id:string,longitude:number,latitude:number,value:number|null=100,currency='USD'):InsuredLocation=>({id,name:id,longitude,latitude,value,currency,region:'',businessLine:''});
describe('portfolio hazard screening',()=>{
  it('distinguishes holes, polygon boundaries and nearby external locations',()=>{
    expect(geometryContains(point(1.5,0),geometry)).toBe(true);
    expect(geometryContains(point(0,0),geometry)).toBe(false);
    expect(geometryContains(point(1,0),geometry)).toBe(true);
    const relevance=screenGeometry([site('inside',1.5,0),site('hole',0,0),site('near',2.05,0),site('outside',3,0)],geometry,10,'Inside published fire perimeter');
    expect(relevance).toMatchObject({inside:1,nearby:1,locationIds:['inside','near'],screeningUnavailable:false});
  });
  it('screens each component of multipolygons and dateline polygons without inverting coverage',()=>{
    const multi:HazardGeometry={type:'MultiPolygon',coordinates:[[square(-10,-1,-9,1)],[square(9,-1,10,1)]]};
    expect(geometryContains(point(9.5,0),multi)).toBe(true);
    expect(geometryContains(point(-9.5,0),multi)).toBe(true);
    expect(geometryContains(point(0,0),multi)).toBe(false);
    const dateline:HazardGeometry={type:'Polygon',coordinates:[square(179,-1,-179,1)]};
    expect(geometryContains(point(179.5,0),dateline)).toBe(true);
    expect(geometryContains(point(-179.5,0),dateline)).toBe(true);
    expect(geometryContains(point(0,0),dateline)).toBe(false);
    expect(distanceToGeometryKm(point(178.95,0),dateline)).toBeCloseTo(5.56,1);
  });
  it('measures to segments rather than vertices and uses spherical distance at high latitude',()=>{
    const large:HazardGeometry={type:'Polygon',coordinates:[square(-5,-1,5,1)]};
    expect(distanceToGeometryKm(point(0,1.1),large)).toBeLessThan(12);
    const polar:HazardGeometry={type:'Polygon',coordinates:[square(179,80,-179,81)]};
    expect(distanceToGeometryKm(point(178.9,80.5),polar)).toBeLessThan(2);
  });
  it('deduplicates locations across classifications and keeps unknown values separate by currency',()=>{
    const a=site('a',0,0,100,'USD'),b=site('b',0,0,200,'CAD'),c=site('c',0,0,null);
    expect(locationRelevance([a,a],[a,b,c,b],[])).toEqual({inside:1,nearby:2,screeningUnavailable:false,reasons:[],locationIds:['a','b','c'],totals:[{currency:'CAD',value:200},{currency:'USD',value:100}],unknownValues:1});
  });
  it('reports missing boundaries as unavailable screening rather than zero matches',()=>{
    expect(screenGeometry([site('site',0,0)],null,10,'Inside')).toMatchObject({screeningUnavailable:true,reasons:['Location screening unavailable: no boundary']});
  });
});
