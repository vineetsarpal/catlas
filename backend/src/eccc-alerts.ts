import { hazardGeometrySchema, weatherAlertSchema, type WeatherAlert } from '@catlas/shared/hazards';

export const ECCC_ALERT_ITEMS='https://api.weather.gc.ca/collections/weather-alerts/items';
const string=(value:unknown)=>typeof value==='string'?value:'';
const iso=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;

/** Keep the provider's area-specific identity; do not infer continuity from place/hazard alone. */
export function parseEcccAlert(feature:any):WeatherAlert|null {
  const p=feature?.properties;
  if(!p||typeof feature.id!=='string'||!feature.id.trim())return null;
  const event=string(p.alert_name_en),area=string(p.feature_name_en),published=iso(p.publication_datetime);
  if(!event||!area||!['warning','watch','advisory','statement'].includes(p.alert_type))return null;
  const expires=[iso(p.expiration_datetime),iso(p.event_end_datetime)].filter((value):value is string=>value!==null).sort()[0];
  // Missing expiry cannot safely be turned into a current observation.
  if(!iso(p.expiration_datetime))return null;
  const geometry=hazardGeometrySchema.safeParse(feature.geometry);
  const status=string(p.status_en).toLowerCase();
  if(!['new','issued','continued','updated','upgraded','downgraded','ended','cancelled','canceled','expired'].includes(status))return null;
  const result=weatherAlertSchema.safeParse({
    id:`eccc:${feature.id}`,references:[],provider:'ECCC',
    name:`${event.charAt(0).toUpperCase()+event.slice(1)} — ${area}${p.province?`, ${string(p.province)}`:''}`,
    event,severity:'Not supplied',certainty:'Not supplied',urgency:'Not supplied',
    issuedAt:published,updatedAt:published,expiresAt:expires,
    active:['new','issued','continued','updated','upgraded','downgraded'].includes(status),
    geometry:geometry.success?geometry.data:null,description:string(p.alert_text_en),
    sourceUrl:`${ECCC_ALERT_ITEMS}/${encodeURIComponent(feature.id)}?f=html`,
    eccc:{area,province:string(p.province),alertType:p.alert_type,status:string(p.status_en),riskColour:string(p.risk_colour_en),impact:string(p.impact_en),confidence:string(p.confidence_en),validAt:iso(p.validity_datetime),eventEndAt:iso(p.event_end_datetime),nameFr:string(p.alert_name_fr),descriptionFr:string(p.alert_text_fr)},
  });
  return result.success?result.data:null;
}

export async function loadEcccAlerts(readJSON:(url:string,budget:{bytes:number})=>Promise<any>) {
  const rows=new Map<string,WeatherAlert>(),visited=new Set<string>();
  const budget={bytes:64*1024*1024};
  let url:string|undefined=`${ECCC_ALERT_ITEMS}?f=json&limit=1000`,rejected=0,unresolved=0,received=0;
  for(let page=0;url&&page<20;page++) {
    const next=new URL(url,ECCC_ALERT_ITEMS);
    if(next.origin!=='https://api.weather.gc.ca'||next.pathname!=='/collections/weather-alerts/items'||next.hash||next.username||next.password)throw Error('Invalid ECCC pagination');
    next.searchParams.set('f','json');url=next.href;
    if(visited.has(url))throw Error('Repeated ECCC page');visited.add(url);
    const data=await readJSON(url,budget);
    if(!Array.isArray(data.features))throw Error('Invalid ECCC collection');
    received+=data.features.length;
    for(const feature of data.features) {
      const row=parseEcccAlert(feature);
      if(!row){rejected++;continue;}
      if(!row.geometry)unresolved++;
      const previous=rows.get(row.id);
      if(!previous||Date.parse(row.updatedAt)>=Date.parse(previous.updatedAt))rows.set(row.id,row);
    }
    const link=Array.isArray(data.links)?data.links.find((link:any)=>link.rel==='next'):undefined;
    if(link&&typeof link.href!=='string')throw Error('Invalid ECCC next link');
    url=link?.href;
    if(!url&&typeof data.numberMatched==='number'&&received<data.numberMatched)throw Error('Truncated ECCC collection');
    if(url&&!data.features.length)throw Error('Empty ECCC continuation page');
  }
  if(url)throw Error('ECCC pagination limit exceeded');
  return {rows:[...rows.values()],rejected,warning:[unresolved?`${unresolved} alert areas lack complete boundaries; location screening unavailable`:'',rejected?`${rejected} ECCC records could not be read`:''].filter(Boolean).join('; ')};
}
