import { fireDetectionSchema, firePerimeterSchema, weatherAlertSchema, hazardGeometrySchema, type FireDetection, type FirePerimeter, type WeatherAlert, type HazardSnapshot, type HazardGeometry } from '@catlas/shared/hazards';

const MINUTE=60_000, DAY=24*60*MINUTE;
const PERIMETERS='https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const SOURCES=['VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT'];
// Fixed regional envelope includes Alaska (including the western Aleutians), Hawaii and CONUS.
const REGIONS=['-180,18,-60,72','170,50,180,72'];
const propertyHazard=/^(Tornado|Severe Thunderstorm|Flash Flood|Flood|Coastal Flood|Lakeshore Flood|Hurricane|Tropical Storm|Storm Surge|High Wind|Extreme Wind|Winter Storm|Ice Storm|Blizzard|Winter Weather|Freezing Rain|Extreme Heat|Excessive Heat|Heat|Extreme Cold|Extreme Wind Chill|Wind Chill|Freeze|Hard Freeze|Red Flag|Fire Weather) (Warning|Watch|Advisory)$/;
type Cache<T>={at:number;snapshot:HazardSnapshot<T>;retryAt:number;pending?:Promise<HazardSnapshot<T>>};
const iso=(value:unknown):string|null=>{const n=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)?new Date(n).toISOString():null;};
const geometry=(value:unknown)=>{const result=hazardGeometrySchema.safeParse(value);return result.success?result.data:null;};
const string=(value:unknown)=>typeof value==='string'?value:'';
const alertId=(value:unknown)=>string(value).replace(/^https:\/\/api\.weather\.gov\/alerts\//,'');

export class HazardService {
  private readonly fetcher:typeof fetch;
  private readonly now:()=>number;
  private readonly key:string;
  private caches=new Map<string,Cache<unknown>>();
  private zonePending=new Map<string,Promise<HazardGeometry|null>>();
  private zones=new Map<string,{at:number;geometry:HazardGeometry|null}>();
  constructor(options:{fetch?:typeof fetch;now?:()=>number;firmsKey?:string}={}){this.fetcher=options.fetch??fetch;this.now=options.now??Date.now;this.key=options.firmsKey?.trim()??'';}
  private async text(url:string,cap=32*1024*1024,budget?:{bytes:number}){
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(30_000),redirect:'error',headers:{'User-Agent':'Catlas local catastrophe monitor','Accept':'application/geo+json,application/json,text/csv'}});
    if(!response.ok){await response.body?.cancel();throw Error('Provider unavailable');}
    if(Number(response.headers.get('content-length'))>cap){await response.body?.cancel();throw Error('Provider response too large');}
    const reader=response.body?.getReader();if(!reader)throw Error('Empty provider response');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(budget)budget.bytes-=value.length;if(size>cap||(budget&&budget.bytes<0))throw Error('Provider response too large');chunks.push(value);}}
    catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
    return Buffer.concat(chunks).toString('utf8');
  }
  private async json(url:string,budget?:{bytes:number}):Promise<any>{return JSON.parse(await this.text(url,32*1024*1024,budget));}
  private async acquire<T>(key:string,ttl:number,load:()=>Promise<{rows:T[];rejected:number;warning?:string;stale?:boolean}>):Promise<HazardSnapshot<T>>{
    const old=this.caches.get(key) as Cache<T>|undefined;
    if(old&&(this.now()-old.at<ttl||this.now()<old.retryAt))return old.snapshot;
    if(old?.pending)return old.pending;
    const entry=old??{at:0,retryAt:0,snapshot:{fetchedAt:new Date(this.now()).toISOString(),stale:true,warning:'Feed unavailable; no evidence acquired',rejected:0,rows:[]}};
    const pending=(async()=>{
      try{const value=await load();entry.at=this.now();entry.retryAt=0;entry.snapshot={fetchedAt:new Date(entry.at).toISOString(),stale:value.stale??false,warning:value.warning??'',rejected:value.rejected,rows:value.rows};}
      catch{entry.retryAt=this.now()+MINUTE;entry.snapshot={...entry.snapshot,stale:true,warning:old?'Refresh failed; previous evidence retained':'Feed unavailable; no evidence acquired'};}
      return entry.snapshot;
    })();
    entry.pending=pending;this.caches.set(key,entry as Cache<unknown>);
    try{return await pending;}finally{entry.pending=undefined;}
  }
  async fires():Promise<HazardSnapshot<FireDetection>>{
    if(!this.key)return {fetchedAt:new Date(this.now()).toISOString(),stale:true,warning:'FIRMS_MAP_KEY is not configured; fire detections unavailable',rejected:0,rows:[]};
    const snapshot=await this.acquire<FireDetection>('fires',30*MINUTE,async()=>{
      const rows:FireDetection[]=[];let rejected=0,success=0;const failed:string[]=[];
      for(const source of SOURCES)for(const bounds of REGIONS){
        try{
          const raw=await this.text(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(this.key)}/${source}/${bounds}/2`);
          const lines=raw.trim().split(/\r?\n/),header=lines.shift()?.split(',')??[];
          if(!['latitude','longitude','acq_date','acq_time'].every(k=>header.includes(k)))throw Error('Invalid FIRMS CSV');
          for(const line of lines){if(!line)continue;const values=line.split(','),p=Object.fromEntries(header.map((k,i)=>[k,values[i]]));
            const time=p.acq_time?.padStart(4,'0');
            const detectedAt=iso(`${p.acq_date}T${time?.slice(0,2)}:${time?.slice(2)}:00Z`);
            const confidence=p.confidence&&/^\d+(\.\d+)?$/.test(p.confidence)?Number(p.confidence):null;
            const result=fireDetectionSchema.safeParse({id:`${source}:${p.latitude}:${p.longitude}:${detectedAt}`,latitude:p.latitude?.trim()?Number(p.latitude):NaN,longitude:p.longitude?.trim()?Number(p.longitude):NaN,detectedAt,source,confidence});
            if(result.success)rows.push(result.data);else rejected++;
          }success++;
        }catch{failed.push(`${source} (${bounds})`);}
      }
      if(!success)throw Error('FIRMS unavailable');
      const previous=this.caches.get('fires')?.snapshot.rows as FireDetection[]|undefined;
      if(failed.length&&previous)rows.push(...previous);
      return {rows:[...new Map(rows.map(row=>[row.id,row])).values()],rejected,stale:failed.length>0,warning:failed.length?'Partial FIRMS coverage; unavailable satellite/region evidence may be retained':''};
    });
    const now=this.now();return {...snapshot,rows:snapshot.rows.filter(row=>{const time=Date.parse(row.detectedAt);return time<=now&&time>now-DAY;})};
  }
  async perimeters():Promise<HazardSnapshot<FirePerimeter>>{
    return this.acquire('perimeters',5*MINUTE,async()=>{
      const rows:FirePerimeter[]=[];let rejected=0,offset=0;const seen=new Map<string,FirePerimeter>();const bodyBudget={bytes:96*1024*1024};
      for(let page=0;page<20;page++){
        const params=new URLSearchParams({where:'1=1',outFields:'OBJECTID,poly_IncidentName,attr_UniqueFireIdentifier,attr_PercentContained,poly_DateCurrent',outSR:'4326',f:'geojson',resultOffset:String(offset),resultRecordCount:'1000',orderByFields:'OBJECTID ASC'});
        const data=await this.json(`${PERIMETERS}?${params}`,bodyBudget);
        if(!Array.isArray(data.features))throw Error('Invalid perimeter response');
        for(const f of data.features){const p=f.properties??{},id=string(p.attr_UniqueFireIdentifier)||String(f.id??p.OBJECTID??'');
          const result=firePerimeterSchema.safeParse({id,name:string(p.poly_IncidentName)||'Unnamed fire incident',geometry:geometry(f.geometry),updatedAt:iso(p.poly_DateCurrent),containment:typeof p.attr_PercentContained==='number'&&p.attr_PercentContained>=0&&p.attr_PercentContained<=100?p.attr_PercentContained:null,sourceUrl:'https://data-nifc.opendata.arcgis.com/'});
          if(result.success){const previous=seen.get(id);if(!previous){rows.push(result.data);seen.set(id,result.data);}else{
            const a=previous.geometry,b=result.data.geometry;
            if(a&&b)previous.geometry={type:'MultiPolygon',coordinates:[...(a.type==='Polygon'?[a.coordinates]:a.coordinates),...(b.type==='Polygon'?[b.coordinates]:b.coordinates)]};else previous.geometry=null;
            if(result.data.updatedAt&&(!previous.updatedAt||result.data.updatedAt>previous.updatedAt)){previous.updatedAt=result.data.updatedAt;previous.containment=result.data.containment;}
          }}else rejected++;
        }
        offset+=data.features.length;
        if(!(data.exceededTransferLimit||data.properties?.exceededTransferLimit))return {rows,rejected,warning:rejected?'Some perimeter records could not be read':''};
        if(!data.features.length)throw Error('Truncated perimeter feed');
      }throw Error('Perimeter pagination limit exceeded');
    });
  }
  private async zone(url:unknown,budget:{remaining:number;deadline:number}):Promise<HazardGeometry|null>{
    if(typeof url!=='string'||!/^https:\/\/api\.weather\.gov\/zones\/(forecast|county|fire)\/[A-Z]{2}[CZ]\d{3}$/.test(url))return null;
    const cached=this.zones.get(url);if(cached&&this.now()-cached.at<DAY)return cached.geometry;
    const pending=this.zonePending.get(url);if(pending)return pending;
    if(budget.remaining--<=0||this.now()>budget.deadline)return null;
    const request=(async()=>{try{const g=geometry((await this.json(url)).geometry);if(!g)return null;this.zones.set(url,{at:this.now(),geometry:g});if(this.zones.size>2000)this.zones.delete(this.zones.keys().next().value!);return g;}catch{return null;}})();
    this.zonePending.set(url,request);try{return await request;}finally{this.zonePending.delete(url);}
  }
  async alerts():Promise<HazardSnapshot<WeatherAlert>>{
    const snapshot=await this.acquire<WeatherAlert>('alerts',MINUTE,async()=>{
      const features:any[]=[];const bodyBudget={bytes:64*1024*1024};let url:string|undefined='https://api.weather.gov/alerts?active=true&status=actual&limit=500';
      for(let page=0;url&&page<20;page++){
        if(!/^https:\/\/api\.weather\.gov\/alerts(?:\/active)?\?[^#]*$/.test(url))throw Error('Invalid alert pagination');
        const data=await this.json(url,bodyBudget);if(!Array.isArray(data.features))throw Error('Invalid alert response');features.push(...data.features);url=data.pagination?.next;
      }if(url)throw Error('Alert pagination limit exceeded');
      const rows:WeatherAlert[]=[];let rejected=0,unresolved=0;
      const selected=features.filter(f=>propertyHazard.test(f.properties?.event??''));
      // Four workers bound zone lookups. Every zone must resolve before screening a zone alert.
      let cursor=0;const zoneBudget={remaining:512,deadline:this.now()+20_000};
      await Promise.all(Array.from({length:4},async()=>{for(;;){const f=selected[cursor++];if(!f)break;const p=f.properties;
        let g=geometry(f.geometry);
        if(!g&&Array.isArray(p.affectedZones)&&p.affectedZones.length&&p.affectedZones.length<=200){const polygons:HazardGeometry[]=[];for(const zone of p.affectedZones){const resolved=await this.zone(zone,zoneBudget);if(!resolved){polygons.length=0;break;}polygons.push(resolved);}if(polygons.length)g={type:'MultiPolygon',coordinates:polygons.flatMap(v=>v.type==='Polygon'?[v.coordinates]:v.coordinates)};}
        if(!g)unresolved++;
        const updatedAt=iso(p.sent),issuedAt=iso(p.effective)??updatedAt,expiresAt=[iso(p.ends),iso(p.expires)].filter((v):v is string=>Boolean(v)).sort()[0];
        const references=Array.isArray(p.references)?p.references.map((r:any)=>alertId(r.identifier)||alertId(r['@id'])).filter(Boolean):[];
        if(Array.isArray(p.parameters?.expiredReferences))for(const reference of p.parameters.expiredReferences){if(typeof reference==='string')references.push(...(reference.match(/urn:oid:[^,\s]+/g)??[]));}
        const result=weatherAlertSchema.safeParse({id:alertId(p.id)||alertId(f.id),references:[...new Set(references)],name:string(p.headline)||string(p.event),event:p.event,severity:string(p.severity),certainty:string(p.certainty),urgency:string(p.urgency),issuedAt,updatedAt,expiresAt,active:p.messageType!=='Cancel'&&p.status==='Actual',geometry:g,description:string(p.description),sourceUrl:typeof f.id==='string'&&f.id.startsWith('https://api.weather.gov/alerts/')?f.id:'https://www.weather.gov/'});
        if(result.success)rows.push(result.data);else rejected++;
      }}));
      // Latest update/cancellation supersedes each identifier in its reference chain.
      const byId=new Map(rows.map(row=>[row.id,row]));
      const superseded=new Set(rows.flatMap(row=>row.references));
      const latest=rows.filter(row=>!superseded.has(row.id)).map(row=>{
        // Preserve every available predecessor before intermediate updates disappear.
        // The visited set bounds work and prevents malformed reference cycles.
        const visited=new Set<string>([row.id]),references:string[]=[],pending=[...new Set(row.references)].slice(0,20_000),queued=new Set([row.id,...pending]);
        for(let i=0;i<pending.length&&visited.size<20_000;i++){
          const id=pending[i];if(visited.has(id))continue;visited.add(id);references.push(id);
          const prior=byId.get(id);if(prior)for(const reference of prior.references)if(!queued.has(reference)&&queued.size<20_000){queued.add(reference);pending.push(reference);}
        }
        return {...row,references};
      });
      return {rows:latest,rejected,warning:[unresolved?`${unresolved} alerts lack complete boundaries; location screening unavailable`:'',rejected?`${rejected} alert records could not be read`:''].filter(Boolean).join('; ')};
    });
    const now=this.now();return {...snapshot,rows:snapshot.rows.map(row=>({...row,active:row.active&&Date.parse(row.expiresAt)>now}))};
  }
}
