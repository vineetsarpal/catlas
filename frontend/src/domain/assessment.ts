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
 // Inspect independently valid fields even when another required input is absent.
 // These reasons never turn an incomplete assessment into a numerical zero.
 const rawEvent = eventInput && typeof eventInput === 'object' ? eventInput as Record<string,unknown> : {};
 const rawContract = contractInput && typeof contractInput === 'object' ? contractInput as Record<string,unknown> : {};
 const occurrence = eventSchema.shape.occurredAt.safeParse(rawEvent.occurredAt);
 const inception = contractSchema.shape.inception.safeParse(rawContract.inception);
 const expiry = contractSchema.shape.expiry.safeParse(rawContract.expiry);
 const outsideCoverage = occurrence.success && inception.success && expiry.success
   && Date.parse(expiry.data)>Date.parse(inception.data)
   && (Date.parse(occurrence.data)<Date.parse(inception.data)||Date.parse(occurrence.data)>=Date.parse(expiry.data));
 if(outsideCoverage) knownFailures.push('Occurrence is outside the UTC coverage interval.');
 const magnitude = eventSchema.shape.magnitude.safeParse(rawEvent.magnitude);
 const magnitudeType = eventSchema.shape.magnitudeType.safeParse(rawEvent.magnitudeType);
 const minimum = contractSchema.shape.minimumMagnitude.safeParse(rawContract.minimumMagnitude);
 if(magnitude.success && magnitudeType.success && minimum.success && magnitude.data < Math.max(6.5,minimum.data??6.5))
   knownFailures.push(`Raw mw magnitude ${magnitude.data} is below the minimum ${Math.max(6.5,minimum.data??6.5)}.`);
 const latitude=eventSchema.shape.latitude.safeParse(rawEvent.latitude), longitude=eventSchema.shape.longitude.safeParse(rawEvent.longitude);
 if(latitude.success && longitude.success && Array.isArray(rawContract.areas)) {
   for(const rawArea of rawContract.areas) {
     if(!rawArea || typeof rawArea !== 'object') continue;
     const areaLatitude=eventSchema.shape.latitude.safeParse(rawArea.latitude);
     const areaLongitude=eventSchema.shape.longitude.safeParse(rawArea.longitude);
     if(areaLatitude.success && areaLongitude.success && distanceKm({latitude:latitude.data,longitude:longitude.data},{latitude:areaLatitude.data,longitude:areaLongitude.data})>100)
       knownFailures.push(`${typeof rawArea.name==='string'?rawArea.name:'Scheduled area'}: epicentre is outside the 100 km trigger zone.`);
   }
 }
 if(!e.success||!c.success) return {ruleVersion:RULE_VERSION,status:'Needs review',amount:null,uncappedSum:null,eventCap:null,areas:[],exceptions,knownFailures};
 const event=e.data, contract=c.data;
 const areas:AreaAssessment[]=contract.areas.map(area=>{const distance=distanceKm(event,area);const cell=matrixCell(event.magnitude,distance,contract.minimumMagnitude);return {areaId:area.id,name:area.name,distanceKm:distance,...cell,allocation:area.allocation,contribution:outsideCoverage?0:cell.rate*area.allocation};});
 const uncappedSum=areas.reduce((s,a)=>s+a.contribution,0), amount=Math.min(uncappedSum,contract.eventCap);
 return {ruleVersion:RULE_VERSION,status:outsideCoverage?'Outside coverage':amount>0?'Trigger met':'Not triggered',amount,uncappedSum,eventCap:contract.eventCap,areas,exceptions,knownFailures};
}
