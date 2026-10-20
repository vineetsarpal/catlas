import { Worker } from 'node:worker_threads';
import { discoverGfs, forecastURL, windRanges, readRange } from '@catlas/shared/wind';
import { readTextResponse } from '@catlas/shared/http';
import type { WindField } from '@catlas/shared/wind';

export function decodeWind(bytes:ArrayBuffer[], runAt:string, validAt:string):Promise<Omit<WindField,'runAt'|'validAt'|'sourceURL'>> {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./wind-decode.mjs',import.meta.url), {workerData:{bytes,runAt,validAt}, transferList:bytes});
    const done = () => {clearTimeout(timer);void worker.terminate();};
    const timer = setTimeout(() => {done();reject(Error('Wind decoding timed out'));},45000);
    worker.once('message', value => {done();if(value.error)reject(Error(value.error));else resolve(value);});
    worker.once('error', () => {done();reject(Error('Wind decoder could not start'));});
    worker.once('exit', code => {if(code !== 0){done();reject(Error('Wind decoder stopped'));}});
  });
}
export class WindService {
  private cache = new Map<string,{field:WindField;fetchedAt:string}>();
  private pending = new Map<string,Promise<{field:WindField;fetchedAt:string}>>();
  private queue:Promise<unknown> = Promise.resolve();
  private metadata:Awaited<ReturnType<typeof discoverGfs>>|null = null;
  private metaAt = 0;
  private metaPending:ReturnType<typeof discoverGfs>|null = null;
  constructor(private fetchImpl:typeof fetch = fetch, private decode = decodeWind) {}
  async discover() {
    if(this.metadata && Date.now()-this.metaAt < 30*60000)return this.metadata;
    this.metaPending ??= discoverGfs(AbortSignal.timeout(25000),this.fetchImpl).then(value => {this.metadata=value;this.metaAt=Date.now();return value;}).finally(()=>{this.metaPending=null;});
    return this.metaPending;
  }
  async get(runAt:string, validAt:string) {
    const run = Date.parse(runAt), valid = Date.parse(validAt);
    if(!Number.isFinite(run+valid) || new Date(run).toISOString() !== runAt || new Date(valid).toISOString() !== validAt || run > Date.now() || Date.now()-run > 7*86400000 || new Date(run).getUTCHours()%6 || new Date(run).getUTCMinutes() || new Date(run).getUTCSeconds() || new Date(run).getUTCMilliseconds())throw Object.assign(Error('Invalid recent GFS model run'),{statusCode:400});
    let url:string;try{url=forecastURL(runAt,validAt);}catch{throw Object.assign(Error('Invalid forecast step'),{statusCode:400});}
    const cached=this.cache.get(url);if(cached)return cached;
    const existing=this.pending.get(url);if(existing)return existing;
    if(this.pending.size>=4)throw Object.assign(Error('Wind queue is full; retry shortly'),{statusCode:429});
    const load=this.queue.catch(()=>{}).then(async()=>{
      const signal=AbortSignal.timeout(60000);
      const index=await readTextResponse(await this.fetchImpl(`${url}.idx`,{signal}),2*1024*1024);
      const ranges=windRanges(index,runAt);
      const bytes=await Promise.all(ranges.map(async({start,end})=>readRange(await this.fetchImpl(url,{signal,headers:{Range:`bytes=${start}-${end}`}}),end-start+1)));
      const field={...await this.decode(bytes,runAt,validAt),runAt,validAt,sourceURL:url};
      const value={field,fetchedAt:new Date().toISOString()};this.cache.set(url,value);
      while(this.cache.size>4)this.cache.delete(this.cache.keys().next().value!);
      return value;
    }).finally(()=>{this.pending.delete(url);});
    this.pending.set(url,load);this.queue=load;return load;
  }
}
