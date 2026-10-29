import { z } from 'zod';
import { readTextResponse } from '@catlas/shared/http';
import { alertSnapshotSchema, fireSnapshotSchema, perimeterSnapshotSchema, type WeatherAlert } from '@catlas/shared/hazards';
import { backendEnabled } from './backend';

export const HAZARD_BACKEND_REQUIRED='Fire and weather warning feeds require the Catlas backend. Start the backend and enable VITE_CATLAS_BACKEND.';
const limits={fires:16*1024*1024,perimeters:80*1024*1024,alerts:32*1024*1024};
async function snapshot<T>(path:keyof typeof limits,schema:z.ZodType<T>,signal:AbortSignal):Promise<T> {
  if(!backendEnabled)throw new Error(HAZARD_BACKEND_REQUIRED);
  signal.throwIfAborted();
  const response=await fetch(`/api/monitor/${path}`,{signal,cache:'no-store'});
  if(!response.ok){
    let detail='';
    try{const body=JSON.parse(await readTextResponse(new Response(response.body),64*1024));if(typeof body.error==='string')detail=body.error;}catch{/* HTTP status remains useful when the body is not JSON. */}
    throw new Error(`${path==='fires'?'Fire detection':path==='perimeters'?'Fire perimeter':'Weather warning'} feed unavailable (${response.status}). ${detail||'Check that the Catlas backend is running.'}`);
  }
  const payload=JSON.parse(await readTextResponse(response,limits[path]));
  signal.throwIfAborted();
  const parsed=schema.safeParse(payload);
  if(!parsed.success)throw new Error('Invalid hazard snapshot received from the backend. Previous evidence has been retained.');
  return parsed.data;
}
export const discoverFires=(signal:AbortSignal)=>snapshot('fires',fireSnapshotSchema,signal);
export const discoverPerimeters=(signal:AbortSignal)=>snapshot('perimeters',perimeterSnapshotSchema,signal);
export const discoverAlerts=(signal:AbortSignal)=>snapshot('alerts',alertSnapshotSchema,signal);

export type HazardWatch={key:string;name:string;references?:string[];updatedAt?:string};
/** Follow CAP reference chains, retaining aliases when an intermediate update leaves the feed. */
export function reconcileAlertWatches(watches:HazardWatch[],alerts:WeatherAlert[]):HazardWatch[] {
  let changed=false;
  const rows=[...alerts].sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt));
  const result=watches.map(watch=>{
    if(!watch.key.startsWith('alert:'))return watch;
    let current=watch;
    for(const alert of rows){
      const aliases=new Set([current.key.slice(6),...(current.references??[])]);
      if(!aliases.has(alert.id)&&!alert.references.some(id=>aliases.has(id)))continue;
      if(current.updatedAt&&Date.parse(alert.updatedAt)<Date.parse(current.updatedAt))continue;
      const references=[...new Set([...aliases,...alert.references])].filter(id=>id!==alert.id).slice(-200);
      const key=`alert:${alert.id}`;
      if(current.key!==key||current.name!==alert.name||current.updatedAt!==alert.updatedAt||JSON.stringify(current.references??[])!==JSON.stringify(references)){
        current={...current,key,name:alert.name,references,updatedAt:alert.updatedAt};changed=true;
      }
    }
    return current;
  });
  if(!changed)return watches;
  return result.filter((watch,index)=>result.findIndex(other=>other.key===watch.key)===index);
}
export function latestAlertKey(key:string,alerts:WeatherAlert[]):string {
  if(!key.startsWith('alert:'))return key;
  return reconcileAlertWatches([{key,name:''}],alerts)[0]?.key??key;
}
