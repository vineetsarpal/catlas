import { z } from 'zod';
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { readTextResponse } from '../exposure/evidence';

export const CYCLONE_SERVICE = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';
export const CYCLONE_COVERAGE = 'Atlantic and eastern/central North Pacific only';
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const line = z.array(position).min(2).max(10000);
const ring = z.array(position).min(4).max(10000).refine(v => v[0][0] === v.at(-1)![0] && v[0][1] === v.at(-1)![1]);
const polygon = z.array(ring).min(1).max(128);
const geometry = z.discriminatedUnion('type', [
  z.object({type:z.literal('Point'),coordinates:position}),
  z.object({type:z.literal('LineString'),coordinates:line}),
  z.object({type:z.literal('MultiLineString'),coordinates:z.array(line).max(128)}),
  z.object({type:z.literal('Polygon'),coordinates:polygon}),
  z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).max(128)}),
]);
const collection = z.object({type:z.literal('FeatureCollection'), exceededTransferLimit:z.boolean().optional(), features:z.array(z.object({type:z.literal('Feature'), geometry, properties:z.object({
  idp_source:z.string().max(100), advisnum:z.string().regex(/^\d{1,3}[a-z]?$/i),
  stormname:z.string().max(150).optional(), advdate:z.string().max(100).optional(),
  idp_filedate:z.number().finite().optional(), tau:z.number().min(0).max(168).optional(), maxwind:z.number().min(0).max(300).optional(),
})})).max(500)});
export type Cyclone = {
  id:string; name:string; longitude:number; latitude:number; advisory:string; advisoryLabel:string;
  sourceUpdatedAt:string; windKt:number|null; track:LineString|MultiLineString|null; cone:Polygon|MultiPolygon|null;
};
export type CycloneSnapshot = { storms:Cyclone[]; warning:string };

// Adapted from God's Eye View's advisory-matching pattern. See public/monitor-sources.md.
export function parseCyclones(pointsRaw:unknown, tracksRaw?:unknown, conesRaw?:unknown, now=Date.now()):CycloneSnapshot {
  const read = (raw:unknown, suffix:string) => {
    const parsed=collection.parse(raw);
    if(parsed.exceededTransferLimit)throw new Error('Cyclone response was truncated.');
    return parsed.features.map(feature=>{
      const match=feature.properties.idp_source.match(/^((?:al|ep|cp)\d{6})-(\d{1,3}[a-z]?)_5day_(pts|lin|pgn)$/i);
      if(!match||match[3].toLowerCase()!==suffix||normalizeAdvisory(match[2])!==normalizeAdvisory(feature.properties.advisnum))throw new Error('Unsupported cyclone advisory identifiers.');
      return {...feature,id:match[1].toLowerCase(),advisory:normalizeAdvisory(match[2])};
    });
  };
  const points=read(pointsRaw,'pts'), tracks=tracksRaw?read(tracksRaw,'lin'):[], cones=conesRaw?read(conesRaw,'pgn'):[];
  const storms:Cyclone[]=[];
  for(const point of points.filter(p=>p.properties.tau===0)) {
    const p=point.properties;
    if(point.geometry.type!=='Point'||!p.stormname||!p.advdate||!p.idp_filedate||now-p.idp_filedate>12*3600000||p.idp_filedate>now+90*60000)throw new Error('Cyclone position metadata is missing or older than 12 hours.');
    if(storms.some(s=>s.id===point.id))throw new Error('Duplicate cyclone positions.');
    const track=tracks.find(t=>t.id===point.id&&t.advisory===point.advisory)?.geometry;
    const cone=cones.find(t=>t.id===point.id&&t.advisory===point.advisory)?.geometry;
    storms.push({id:point.id,name:p.stormname,longitude:point.geometry.coordinates[0],latitude:point.geometry.coordinates[1],advisory:point.advisory,advisoryLabel:p.advdate,sourceUpdatedAt:new Date(p.idp_filedate).toISOString(),windKt:p.maxwind??null,
      track:track&&(track.type==='LineString'||track.type==='MultiLineString')?track:null,
      cone:cone&&(cone.type==='Polygon'||cone.type==='MultiPolygon')?cone:null});
  }
  if(points.length&&!storms.length)throw new Error('No supported current cyclone positions in the response.');
  return {storms,warning:storms.some(s=>!s.track||!s.cone)?'Some forecast geometry is unavailable or belongs to a different advisory. Only matching geometry is shown.':''};
}
function normalizeAdvisory(value:string){return value.replace(/^0+(?=\d)/,'').toUpperCase();}
async function json(url:string,signal:AbortSignal) {
  return JSON.parse(await readTextResponse(await fetch(url,{signal,cache:'no-cache'}),4*1024*1024));
}
export async function discoverCyclones(signal:AbortSignal):Promise<CycloneSnapshot> {
  const query=(layer:number)=>`${CYCLONE_SERVICE}/${layer}/query?${new URLSearchParams({where:'1=1',outFields:'*',outSR:'4326',f:'geojson'})}`;
  const results=await Promise.allSettled([5,6,7].map(layer=>json(query(layer),signal)));
  if(results[0].status==='rejected')throw results[0].reason;
  return parseCyclones(results[0].value,results[1].status==='fulfilled'?results[1].value:undefined,results[2].status==='fulfilled'?results[2].value:undefined);
}
export type WindMetadata = {runAt:string; times:string[]; defaultTime:string};
export function cycloneFeatures(storms:Cyclone[]):FeatureCollection {
  return {type:'FeatureCollection',features:storms.flatMap(s=>{
    const properties={key:`cyclone:${s.id}`,name:s.name,advisory:s.advisory};
    const features:Feature[]=[{type:'Feature',properties,geometry:{type:'Point',coordinates:[s.longitude,s.latitude]}}];
    if(s.track)features.push({type:'Feature',properties,geometry:s.track});
    if(s.cone)features.push({type:'Feature',properties,geometry:s.cone});
    return features;
  })};
}
