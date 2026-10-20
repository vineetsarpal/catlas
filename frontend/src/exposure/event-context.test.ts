import { describe, expect, it } from 'vitest';
import { sameObservation, sameRecoveryEvent, recoveryEventFromExposure } from './event-context';
import type { CapturedEvidence, Earthquake } from './model';
const event: Earthquake = {id:'us-test',name:'Captured event',magnitude:7.1,longitude:12,latitude:34,occurredAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T01:00:00Z'};
function evidence(type:string,id=event.id): CapturedEvidence {
  return {rawXml:'',rawEventJson:JSON.stringify({id,properties:{mag:7.1,magType:type}}),grid:{longitudes:[0,1],latitudes:[0,1],values:[4,4,4,4]},manifest:{eventId:event.id,aliases:[],eventName:event.name,occurredAt:event.occurredAt,magnitude:7.1,longitude:12,latitude:34,productId:'grid',provider:'us',productVersion:'1',productUpdatedAt:event.updatedAt,processedAt:event.updatedAt,capturedAt:event.updatedAt,sourceUrl:'https://earthquake.usgs.gov/grid.xml',rawSha256:'a'.repeat(64),retrospective:false,eventDetailUrl:'https://earthquake.usgs.gov/event',eventDetailSha256:'b'.repeat(64),measure:'MMI',units:'intensity'}};
}
describe('shared earthquake context',()=>{
 it('keeps coordinates, time, literal magnitude type and frozen source identity',()=>{
  const transferred=recoveryEventFromExposure(event,evidence('Mw'));
  expect(transferred.magnitudeType).toBe('Mw');
  expect(sameObservation(transferred,event)).toBe(true);
  expect(transferred.evidenceVersion).toBe('b'.repeat(64));
 });
 it('does not invent a supported magnitude type for missing or mismatched source observations',()=>{
  expect(recoveryEventFromExposure(event,null).magnitudeType).toBeNull();
  expect(recoveryEventFromExposure(event,evidence('mw','other-event')).magnitudeType).toBeNull();
 });
 it('matches serialized observations regardless of property order and detects revisions',()=>{
  const original=recoveryEventFromExposure(event,evidence('mw'));
  const reordered=Object.fromEntries(Object.entries(original).reverse());
  expect(sameRecoveryEvent(original,reordered)).toBe(true);
  expect(sameRecoveryEvent(original,{...original,magnitude:6.9})).toBe(false);
  expect(sameObservation({...original,latitude:35},event)).toBe(false);
 });
});
