import { geoCircle, geoDistance } from 'd3-geo';
import { contractSchema, eventSchema, type Assessment, type AreaAssessment } from './types';
export const EARTH_RADIUS_KM = 6371;
export const RULE_VERSION = 'catlas-two-area-1';
export function distanceKm(a: {longitude:number;latitude:number}, b: {longitude:number;latitude:number}) { return geoDistance([a.longitude,a.latitude],[b.longitude,b.latitude])*EARTH_RADIUS_KM; }
export function triggerPolygon(reference:{longitude:number;latitude:number}, km:number) { return geoCircle().center([reference.longitude,reference.latitude]).radius(km/EARTH_RADIUS_KM*180/Math.PI).precision(2)(); }
export function matrixCell(magnitude:number, distance:number, minimumMagnitude=6.5) {
 const band = distance<=25?'inner':distance<=100?'outer':'outside';
 const row = magnitude<6.5?'<6.5':magnitude<7?'6.5–<7.0':magnitude<7.5?'7.0–<7.5':'≥7.5';
 const inner = magnitude<minimumMagnitude||magnitude<6.5?0:magnitude<7?0.5:magnitude<7.5?0.75:1;
 return {band,magnitudeRow:row,rate:band==='inner'?inner:band==='outer'?inner/2:0} as const;
}
export function assess(eventInput: unknown, contractInput: unknown): Assessment {
 const e=eventSchema.safeParse(eventInput), c=contractSchema.safeParse(contractInput);
 const exceptions=[...(!e.success?e.error.issues.map(i=>`Event ${i.path.join('.')}: ${i.message}`):[]),...(!c.success?c.error.issues.map(i=>`Contract ${i.path.join('.')}: ${i.message}`):[])];
 const knownFailures:string[]=[];
 if(e.success&&c.success&&(Date.parse(e.data.occurredAt)<Date.parse(c.data.inception)||Date.parse(e.data.occurredAt)>=Date.parse(c.data.expiry))) knownFailures.push('Occurrence is outside the UTC coverage interval.');
 if(!e.success||!c.success) return {ruleVersion:RULE_VERSION,status:'Needs review',amount:null,uncappedSum:null,eventCap:null,areas:[],exceptions,knownFailures};
 const event=e.data, contract=c.data;
 const areas:AreaAssessment[]=contract.areas.map(area=>{const distance=distanceKm(event,area);const cell=matrixCell(event.magnitude,distance,contract.minimumMagnitude);return {areaId:area.id,name:area.name,distanceKm:distance,...cell,allocation:area.allocation,contribution:knownFailures.length?0:cell.rate*area.allocation};});
 const uncappedSum=areas.reduce((s,a)=>s+a.contribution,0), amount=Math.min(uncappedSum,contract.eventCap);
 return {ruleVersion:RULE_VERSION,status:knownFailures.length?'Outside coverage':amount>0?'Trigger met':'Not triggered',amount,uncappedSum,eventCap:contract.eventCap,areas,exceptions,knownFailures};
}
