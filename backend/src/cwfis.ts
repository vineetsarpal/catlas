import { fireDetectionSchema, firePerimeterSchema, type FireDetection, type FirePerimeter, CWFIS_ESTIMATE_WINDOW } from '@catlas/shared/hazards';

const LEGACY='https://cwfis.cfs.nrcan.gc.ca/geoserver/ows';
const CWFIF='https://geoserver.cwfif.nrcan.gc.ca/geoserver/ows';
export const CWFIS_SOURCE='https://cwfis.cfs.nrcan.gc.ca/en/';
const DAY=24*3600_000;
type ReadJSON=(url:string,budget:{bytes:number})=>Promise<any>;
type Layer='hotspots_24h'|'cwfif_national_activefires'|'m3polygons';
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const id=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?String(value):text(value);
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;

/** Fixed WFS queries: explicit time filters, stable sorting, bounded pagination and bytes. */
async function features(read:ReadJSON,layer:Layer,filter:string,sortBy:string) {
  const base=layer==='cwfif_national_activefires'?CWFIF:LEGACY;
  const budget={bytes:64*1024*1024},rows:any[]=[],seen=new Set<string>();
  let total:number|undefined;
  for(let page=0;page<20;page++) {
    const params=new URLSearchParams({service:'WFS',version:'2.0.0',request:'GetFeature',typeNames:`public:${layer}`,outputFormat:'application/json',srsName:'CRS:84',count:'1000',startIndex:String(rows.length),sortBy,CQL_FILTER:filter});
    const data=await read(`${base}?${params}`,budget);
    if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||!Number.isSafeInteger(data.numberMatched)||data.numberMatched<0)throw Error('Invalid CWFIS collection');
    if(total!==undefined&&total!==data.numberMatched)throw Error('CWFIS collection changed during pagination');
    total=data.numberMatched;
    if(data.numberReturned!==undefined&&data.numberReturned!==data.features.length)throw Error('Truncated CWFIS page');
    for(const feature of data.features) {
      // GeoServer feature IDs are request-generated; use published record identifiers instead.
      const key=id(feature.properties?.[layer==='cwfif_national_activefires'?'id':'uid']);
      if(key&&seen.has(key))throw Error('Repeated CWFIS page or record');
      if(key)seen.add(key);
      rows.push(feature);
    }
    if(rows.length===total)return rows;
    if(!data.features.length||rows.length>data.numberMatched)throw Error('Truncated CWFIS collection');
  }
  throw Error('CWFIS pagination limit exceeded');
}

export async function loadCwfisHotspots(read:ReadJSON,now:number) {
  const end=new Date(now).toISOString(),start=new Date(now-DAY).toISOString();
  const raw=await features(read,'hotspots_24h',`rep_date > ${start} AND rep_date <= ${end}`,'uid A');
  const rows:FireDetection[]=[];let rejected=0;
  for(const feature of raw) {
    const p=feature.properties??{},uid=id(p.uid),detectedAt=date(p.rep_date);
    if(!uid||!detectedAt){rejected++;continue;}
    if(Date.parse(detectedAt)<=now-DAY||Date.parse(detectedAt)>now)continue;
    const point=feature.geometry?.type==='Point'?feature.geometry.coordinates:[];
    const parsed=fireDetectionSchema.safeParse({id:`cwfis:hotspot:${uid}`,provider:'CWFIS',longitude:point[0],latitude:point[1],detectedAt,source:`CWFIS · ${[text(p.satellite),text(p.sensor)].filter(Boolean).join(' / ')||'satellite hotspot'}`,confidence:null});
    if(parsed.success)rows.push(parsed.data);else rejected++;
  }
  return {rows,rejected,warning:rejected?'Some CWFIS hotspot records could not be read':''};
}

export async function loadCwfisIncidents(read:ReadJSON,now:number) {
  const at=new Date(now).toISOString();
  const raw=await features(read,'cwfif_national_activefires',`record_start <= ${at} AND record_end >= ${at}`,'national_fire_id A,record_start D,id A');
  const latest=new Map<string,FirePerimeter>();let rejected=0;
  for(const feature of raw) {
    const p=feature.properties??{},nationalId=text(p.national_fire_id),recordStart=date(p.record_start),recordEnd=date(p.record_end),updatedAt=date(p.status_date);
    if(!nationalId||!recordStart||!recordEnd||!updatedAt||recordStart>recordEnd){rejected++;continue;}
    if(Date.parse(recordStart)>now||Date.parse(recordEnd)<now)continue;
    const point=feature.geometry?.type==='Point'?feature.geometry.coordinates:[];
    const containment=typeof p.percent_contained==='number'&&p.percent_contained>=0&&p.percent_contained<=100?p.percent_contained:null;
    const parsed=firePerimeterSchema.safeParse({id:`cwfis:incident:${nationalId}`,name:`${text(p.agency_code)} ${text(p.agency_fire_id)||nationalId}`.trim(),provider:'CWFIS',evidence:'reported-incident',geometry:null,position:{longitude:point[0],latitude:point[1]},updatedAt,containment,sourceUrl:CWFIS_SOURCE,cwfis:{agency:text(p.agency_code),status:text(p.stage_of_control_status),recordStart,recordEnd}});
    if(!parsed.success){rejected++;continue;}
    const previous=latest.get(parsed.data.id);
    if(!previous||recordStart>previous.cwfis!.recordStart!)latest.set(parsed.data.id,parsed.data);
  }
  return {rows:[...latest.values()],rejected,warning:rejected?'Some CWFIS incident records could not be read':''};
}

export async function loadCwfisEstimates(read:ReadJSON,now:number) {
  const start=new Date(now-CWFIS_ESTIMATE_WINDOW).toISOString(),end=new Date(now).toISOString();
  const raw=await features(read,'m3polygons',`lastdate > ${start} AND lastdate <= ${end}`,'uid A');
  const rows:FirePerimeter[]=[];let rejected=0;
  for(const feature of raw) {
    const p=feature.properties??{},uid=id(p.uid),lastDetectedAt=date(p.lastdate);
    if(!uid||!lastDetectedAt){rejected++;continue;}
    if(Date.parse(lastDetectedAt)<=now-CWFIS_ESTIMATE_WINDOW||Date.parse(lastDetectedAt)>now)continue;
    const parsed=firePerimeterSchema.safeParse({id:`cwfis:estimate:${uid}`,name:`CWFIS estimated fire area ${uid}`,provider:'CWFIS',evidence:'estimated-perimeter',geometry:feature.geometry,updatedAt:null,containment:null,sourceUrl:CWFIS_SOURCE,cwfis:{agency:'',status:'',lastDetectedAt}});
    // A malformed estimate must never become a reported incident or a fabricated boundary.
    if(parsed.success&&parsed.data.geometry)rows.push(parsed.data);else rejected++;
  }
  return {rows,rejected,warning:rejected?'Some CWFIS estimated boundaries could not be read':''};
}

