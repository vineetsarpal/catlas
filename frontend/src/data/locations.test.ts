import {describe,it,expect} from 'vitest';
import { contextLocations } from './locations';
import { outerEvent } from './outer-event';
import { mainContract } from './fixtures';
import { assess } from '../domain/assessment';
describe('CAT-14 amended exploration fixtures',()=>{
 it('retains the 18 canonical stable contextual IDs and amended sites',()=>{
  expect(contextLocations).toHaveLength(18);
  expect(new Set(contextLocations.map(l=>l.id)).size).toBe(18);
  expect(contextLocations.slice(2,3)).toEqual([{id:'DEMO-LOC-03',name:'Lancaster',longitude:-118.14,latitude:34.7,group:'Western'}]);
  expect(contextLocations.slice(5,8).map(l=>[l.id,l.name,l.longitude,l.latitude,l.group])).toEqual([
   ['DEMO-LOC-06','Ridgecrest',-117.67,35.62,'Mojave'],['DEMO-LOC-07','Trona',-117.37,35.76,'Mojave'],['DEMO-LOC-08','Tehachapi',-118.45,35.13,'Western'],
  ]);
 });
 it('labels the outer event synthetic and applies exactly one rate per area',()=>{
  expect(outerEvent.provenance.kind).toBe('synthetic');expect(outerEvent.id).toBe('SIM-OUTER-01');
  expect(outerEvent.occurredAt).toBe('2019-07-07T12:00:00.000Z');
  const result=assess(outerEvent,mainContract);
  expect(result.areas.map(a=>[a.band,a.rate,a.contribution])).toEqual([['outer',0.375,2250000],['outer',0.375,1500000]]);
  expect(result.amount).toBe(3750000);
 });
});
