import { backendEnabled, WIND_BACKEND_REQUIRED } from './backend';
import type { WindMetadata, WindField } from '@catlas/shared/wind';
import { forecastURL } from '@catlas/shared/wind';
export type { WindField } from '@catlas/shared/wind';
let cached:WindField|null=null,cacheAt=0;
export async function loadWindField(meta:WindMetadata,time:string,signal:AbortSignal,onStatus:(text:string)=>void):Promise<WindField> {
  if(!backendEnabled)throw new Error(WIND_BACKEND_REQUIRED);
  signal.throwIfAborted();
  const url=forecastURL(meta.runAt,time);if(cached?.sourceURL===url&&Date.now()-cacheAt<5*60000)return cached;
  onStatus('Loading wind vectors from the local backend…');
  const response=await fetch(`/api/monitor/wind/grid?${new URLSearchParams({runAt:meta.runAt,validAt:time})}`,{signal});
  if(!response.ok)throw new Error(`Local wind backend unavailable (${response.status}).`);
  const header=JSON.parse(response.headers.get('X-Wind-Metadata')??'null');
  if(!header||header.nx!==360||header.ny!==181||header.lo1!==0||header.la1!==90||header.dx!==1||header.dy!==1||header.runAt!==meta.runAt||header.validAt!==time||header.sourceURL!==url)throw new Error('Invalid backend wind metadata.');
  const bytes=await response.arrayBuffer(),count=360*181;
  if(bytes.byteLength!==count*8)throw new Error('Invalid backend wind grid length.');
  const view=new DataView(bytes),u=new Float32Array(count),v=new Float32Array(count);
  for(let i=0;i<count;i++){u[i]=view.getFloat32(i*4,true);v[i]=view.getFloat32((count+i)*4,true);}
  if(!u.every(v=>Number.isFinite(v)&&Math.abs(v)<180)||!v.every(v=>Number.isFinite(v)&&Math.abs(v)<180))throw new Error('Invalid backend wind values.');
  const field:WindField={...header,u,v};cached=field;cacheAt=Date.now();return field;
}
// Sampling and advection follow God's Eye View's seam-wrapped field model (MIT; see source notice).
export function sampleWind(field:Pick<WindField,'nx'|'ny'|'lo1'|'la1'|'dx'|'dy'|'u'|'v'>,lon:number,lat:number) {
  if(!Number.isFinite(lon+lat)||lat>field.la1||lat<field.la1-(field.ny-1)*field.dy)return null;
  const x=(((lon-field.lo1)%360)+360)%360/field.dx,y=Math.max(0,Math.min(field.ny-1,(field.la1-lat)/field.dy));
  const x0=Math.floor(x)%field.nx,x1=(x0+1)%field.nx,y0=Math.floor(y),y1=Math.min(field.ny-1,y0+1),tx=x-Math.floor(x),ty=y-y0;
  const read=(a:Float32Array)=>(a[y0*field.nx+x0]*(1-tx)+a[y0*field.nx+x1]*tx)*(1-ty)+(a[y1*field.nx+x0]*(1-tx)+a[y1*field.nx+x1]*tx)*ty;
  const u=read(field.u),v=read(field.v);return Number.isFinite(u+v)&&Math.hypot(u,v)<=180?{u,v}:null;
}
