import type { HazardGeometry } from '@catlas/shared/hazards';
import type { InsuredLocation } from '../exposure/model';

type Point = { longitude:number; latitude:number };
type Position = number[];
const radians=Math.PI/180, earthRadiusKm=6371;
export function distanceKm(a:Point,b:Point) {
  const lat=(b.latitude-a.latitude)*radians,lon=(b.longitude-a.longitude)*radians;
  const h=Math.sin(lat/2)**2+Math.cos(a.latitude*radians)*Math.cos(b.latitude*radians)*Math.sin(lon/2)**2;
  return earthRadiusKm*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
const vector=([lon,lat]:Position)=>[Math.cos(lat*radians)*Math.cos(lon*radians),Math.cos(lat*radians)*Math.sin(lon*radians),Math.sin(lat*radians)];
const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const angle=(a:number[],b:number[])=>Math.atan2(Math.hypot(...cross(a,b)),Math.max(-1,Math.min(1,dot(a,b))));
function segmentDistanceKm(point:Point,start:Position,end:Position) {
  const p=vector([point.longitude,point.latitude]),a=vector(start),b=vector(end),normal=cross(a,b),norm=dot(normal,normal);
  let nearest=Math.min(angle(p,a),angle(p,b));
  if(norm>1e-20) {
    const projected=p.map((n,i)=>n-normal[i]*dot(p,normal)/norm),length=Math.hypot(...projected);
    if(length>1e-12) for(const sign of [1,-1]) {
      const candidate=projected.map(n=>sign*n/length);
      if(Math.abs(angle(a,candidate)+angle(candidate,b)-angle(a,b))<1e-9)nearest=Math.min(nearest,angle(p,candidate));
    }
  }
  return nearest*earthRadiusKm;
}
type PreparedRing={coordinates:Position[];unwrapped:Position[]};
type PreparedPolygon={rings:PreparedRing[];west:number;east:number;south:number;north:number;centre:number;arcPadding:number};
const prepared=new WeakMap<HazardGeometry,PreparedPolygon[]>();
function prepare(geometry:HazardGeometry) {
  let polygons=prepared.get(geometry);
  if(polygons)return polygons;
  polygons=(geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).map(coordinates=>{
    const rings=coordinates.map(ring=>{
      const unwrapped:Position[]=[];
      for(const [lon,lat] of ring) {
        const previous=unwrapped.at(-1)?.[0]??lon;
        unwrapped.push([previous+(((lon-previous+180)%360+360)%360)-180,lat]);
      }
      return {coordinates:ring,unwrapped};
    });
    let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity,arcPadding=0;
    const outer=rings[0];
    for(let i=0;i<outer.unwrapped.length;i++) {
      const [lon,lat]=outer.unwrapped[i];west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);
      if(i)arcPadding=Math.max(arcPadding,angle(vector(outer.coordinates[i-1]),vector(outer.coordinates[i]))/radians);
    }
    return {rings,west,east,south,north,centre:(west+east)/2,arcPadding};
  });
  prepared.set(geometry,polygons);return polygons;
}
function inRing(point:Point,ring:PreparedRing) {
  const unwrapped=ring.unwrapped,centre=(unwrapped[0][0]+unwrapped.reduce((sum,p)=>sum+p[0],0)/unwrapped.length)/2;
  const x=point.longitude+360*Math.round((centre-point.longitude)/360),y=point.latitude;
  let inside=false;
  for(let i=0,j=unwrapped.length-1;i<unwrapped.length;j=i++) {
    const a=unwrapped[i],b=unwrapped[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function candidate(point:Point,polygon:PreparedPolygon,km:number) {
  // A segment cannot leave its endpoint latitude range by more than its arc
  // length. This conservative padding also covers curved great-circle edges.
  const padding=km/earthRadiusKm/radians+polygon.arcPadding;
  if(point.latitude<polygon.south-padding||point.latitude>polygon.north+padding)return false;
  const extremeLatitude=Math.min(90,Math.max(Math.abs(polygon.south),Math.abs(polygon.north))+padding);
  const longitudePadding=extremeLatitude>=90?360:padding/Math.cos(extremeLatitude*radians);
  const longitude=point.longitude+360*Math.round((polygon.centre-point.longitude)/360);
  return longitude>=polygon.west-longitudePadding&&longitude<=polygon.east+longitudePadding;
}
function polygonDistance(point:Point,polygon:PreparedPolygon) {
  let distance=Infinity;
  for(const ring of polygon.rings)for(let i=1;i<ring.coordinates.length;i++)distance=Math.min(distance,segmentDistanceKm(point,ring.coordinates[i-1],ring.coordinates[i]));
  return distance;
}
export function distanceToGeometryKm(point:Point,geometry:HazardGeometry) {
  return Math.min(...prepare(geometry).map(polygon=>polygonDistance(point,polygon)));
}
function classify(point:Point,geometry:HazardGeometry,nearbyKm:number):'inside'|'nearby'|'outside' {
  let nearby=false;
  for(const polygon of prepare(geometry)) {
    if(!candidate(point,polygon,nearbyKm))continue;
    if(inRing(point,polygon.rings[0])&&!polygon.rings.slice(1).some(hole=>inRing(point,hole)))return 'inside';
    const distance=polygonDistance(point,polygon);
    if(distance<1e-6)return 'inside';
    if(nearbyKm>0&&distance<=nearbyKm)nearby=true;
  }
  return nearby?'nearby':'outside';
}
export function geometryContains(point:Point,geometry:HazardGeometry) {return classify(point,geometry,0)==='inside';}
export function geometryPosition(geometry:HazardGeometry|null):Point|null {
  const first=geometry? (geometry.type==='Polygon'?geometry.coordinates[0][0]:geometry.coordinates[0][0][0]):null;
  return first?{longitude:first[0],latitude:first[1]}:null;
}
export type HazardRelevance={inside:number;nearby:number;screeningUnavailable:boolean;reasons:string[];locationIds:string[];totals:Array<{currency:string;value:number}>;unknownValues:number};
export function locationRelevance(inside:InsuredLocation[],nearby:InsuredLocation[],reasons:string[],screeningUnavailable=false):HazardRelevance {
  const insideUnique=new Map(inside.map(site=>[site.id,site]));
  const nearbyUnique=new Map(nearby.filter(site=>!insideUnique.has(site.id)).map(site=>[site.id,site]));
  const selected=[...insideUnique.values(),...nearbyUnique.values()],totals=new Map<string,number>();
  for(const site of selected)if(site.value!==null)totals.set(site.currency,(totals.get(site.currency)??0)+site.value);
  return {inside:insideUnique.size,nearby:nearbyUnique.size,screeningUnavailable,reasons,locationIds:selected.map(site=>site.id),totals:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,value])=>({currency,value})),unknownValues:selected.filter(site=>site.value===null).length};
}
export function screenGeometry(locations:InsuredLocation[],geometry:HazardGeometry|null,nearbyKm:number,insideReason:string):HazardRelevance {
  if(!geometry)return locationRelevance([],[],['Location screening unavailable: no boundary'],true);
  const inside:InsuredLocation[]=[],nearby:InsuredLocation[]=[];
  for(const site of locations) {
    const classification=classify(site,geometry,nearbyKm);
    if(classification==='inside')inside.push(site);
    else if(classification==='nearby')nearby.push(site);
  }
  return locationRelevance(inside,nearby,[...(inside.length?[insideReason]:[]),...(nearby.length?['Near published fire perimeter']:[])]);
}
