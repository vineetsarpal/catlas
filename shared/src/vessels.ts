import { z } from 'zod';
export const vesselIdentity=z.object({name:z.string().trim().min(1).max(120),mmsi:z.string().regex(/^\d{9}$/).optional(),imo:z.string().regex(/^\d{7}$/).optional()}).refine(v=>v.mmsi||v.imo,'Supply an MMSI or IMO');
export const vesselPortfolio=z.array(vesselIdentity).max(200).refine(rows=>new Set(rows.map(v=>`${v.mmsi??''}/${v.imo??''}`)).size===rows.length,'Duplicate vessel identity');
export type VesselIdentity=z.infer<typeof vesselIdentity>;
export const vesselSchema=z.object({mmsi:z.string().regex(/^\d{9}$/),imo:z.string(),name:z.string(),longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90),speed:z.number().nullable(),course:z.number().nullable(),reportedAt:z.string().datetime(),receivedAt:z.string().datetime(),trail:z.array(z.tuple([z.number(),z.number(),z.string()])).max(32)});
export type Vessel=z.infer<typeof vesselSchema>;
export const vesselSnapshot=z.object({status:z.enum(['unconfigured','connecting','live','stale','error','idle']),message:z.string(),checkedAt:z.string(),lastMessageAt:z.string().nullable(),startedAt:z.string().nullable(),rows:z.array(vesselSchema).max(1000),truncated:z.boolean()});
export type VesselSnapshot=z.infer<typeof vesselSnapshot>;
export function inVesselPortfolio(v:Pick<Vessel,'mmsi'|'imo'>,portfolio:VesselIdentity[]){return portfolio.some(p=>Boolean(p.mmsi&&p.mmsi===v.mmsi)||Boolean(p.imo&&p.imo===v.imo));}
// RFC 4180 quoting, including escaped quotes and embedded newlines.
export function parseVesselCSV(text:string):VesselIdentity[] {
  if(text.length>100000)throw Error('Vessel CSV is too large (100 KB maximum)');
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  const finish=()=>{row.push(field.trim());field='';closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('Invalid CSV quoting');quoted=true;}
    else if(c===',')finish();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finish();if(row.some(Boolean))rows.push(row);row=[];}
    else {if(closed&&!/\s/.test(c))throw Error('Invalid CSV quoting');field+=c;}
  }
  if(quoted)throw Error('Unclosed CSV quote');finish();if(row.some(Boolean))rows.push(row);
  const header=rows.shift()?.map(v=>v.replace(/^\uFEFF/,'').toLowerCase());
  if(!header||!header.includes('name')||!header.some(v=>v==='mmsi'||v==='imo')||new Set(header).size!==header.length||header.some(v=>!['name','mmsi','imo'].includes(v)))throw Error('Use CSV columns name,mmsi,imo (at least one identifier)');
  return vesselPortfolio.parse(rows.map(values=>{
    if(values.length!==header.length)throw Error('CSV column count mismatch');
    return Object.fromEntries(header.map((key,i)=>[key,values[i]||undefined]));
  }));
}
