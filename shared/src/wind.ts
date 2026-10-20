import { readTextResponse } from './http';
export type WindMetadata = {runAt:string; times:string[]; defaultTime:string};
export type WindField={nx:number;ny:number;lo1:number;la1:number;dx:number;dy:number;u:Float32Array;v:Float32Array;runAt:string;validAt:string;sourceURL:string;decodeMs:number};
export const GFS_SOURCE='https://noaa-gfs-bdp-pds.s3.amazonaws.com';
export function forecastURL(runAt:string,validAt:string) {
  const run=new Date(runAt),hour=String(run.getUTCHours()).padStart(2,'0'),step=(Date.parse(validAt)-run.getTime())/3600000;
  if(!Number.isInteger(step)||step<0||step>48||step%3)throw new Error('Unsupported GFS forecast step.');
  return `${GFS_SOURCE}/gfs.${run.toISOString().slice(0,10).replaceAll('-','')}/${hour}/atmos/gfs.t${hour}z.pgrb2.1p00.f${String(step).padStart(3,'0')}`;
}
export function windRanges(index:string,runAt:string) {
  const expected=new Date(runAt).toISOString().slice(0,13).replaceAll('-','').replace('T','');
  const rows=index.trim().split(/\r?\n/).map(line=>line.split(':')).filter(parts=>/^\d+$/.test(parts[0])&&/^\d+$/.test(parts[1]));
  return ['UGRD','VGRD'].map(variable=>{
    const i=rows.findIndex(row=>row[3]===variable&&row[4]==='10 m above ground');
    const row=rows[i],next=rows[i+1];
    if(!row||!next||row[2]!==`d=${expected}`)throw new Error('The wind inventory is missing matching surface components.');
    const start=Number(row[1]),end=Number(next[1])-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>8*1024*1024)throw new Error('Invalid wind byte range.');
    return {start,end};
  });
}
export async function discoverGfs(signal:AbortSignal,fetchImpl:typeof fetch=fetch):Promise<WindMetadata> {
  const latest=new Date(Date.now()-5*3600000);latest.setUTCMinutes(0,0,0);latest.setUTCHours(Math.floor(latest.getUTCHours()/6)*6);
  for(let attempt=0;attempt<2;attempt++){
    const runAt=new Date(latest.getTime()-attempt*6*3600000).toISOString();
    const step=Math.max(0,Math.min(48,Math.round((Date.now()-Date.parse(runAt))/10800000)*3));
    const defaultTime=new Date(Date.parse(runAt)+step*3600000).toISOString();
    const response=await fetchImpl(`${forecastURL(runAt,defaultTime)}.idx`,{signal,cache:'no-cache'});
    if(response.status===404&&attempt===0){await response.body?.cancel();continue;}
    windRanges(await readTextResponse(response,2*1024*1024),runAt);
    return {runAt,defaultTime,times:Array.from({length:17},(_,i)=>new Date(Date.parse(runAt)+i*10800000).toISOString())};
  }
  throw new Error('No recent GFS forecast is available.');
}
export async function readRange(response:Response,length:number):Promise<ArrayBuffer> {
  if(response.status!==206){await response.body?.cancel();throw new Error('NOAA did not return the requested partial wind data.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Wind data has no response body.');
  const output=new Uint8Array(length);let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;if(size+value.length>length){await reader.cancel();throw new Error('Wind response exceeds the requested range.');}output.set(value,size);size+=value.length;}
  if(size!==length)throw new Error('Wind response is incomplete.');
  return output.buffer;
}
