import { describe, expect, it } from 'vitest';
import { assessLoss, lossPositionSchema, recoveryCaseKey, verifySnapshot, type LossPosition } from './model';
import { ridgecrest } from '../data/fixtures';
const position: LossPosition = {entity:'Example insurer',businessLine:'Property',source:'Claims estimate 1',valuationDate:'2019-07-10',currency:'USD',eligibleLoss:20_000_000,treaty:'CAT 2019 v1',inception:'2019-01-01',expiry:'2019-12-31',retention:10_000_000,limit:15_000_000,availableLimit:15_000_000,share:100,confirmed:true};
describe('single occurrence recovery',()=>{
  it('shows the recovery and remaining loss for a partially used layer',()=>{
    expect(assessLoss(position,ridgecrest)).toEqual({eligibleLoss:20_000_000,aboveRetention:10_000_000,layerLoss:10_000_000,recovery:10_000_000,retainedLoss:10_000_000,outsideCoverage:false});
  });
  it.each([0,9_000_000,10_000_000])('does not attach below or at retention (%s)',eligibleLoss=>{
    expect(assessLoss({...position,eligibleLoss},ridgecrest).recovery).toBe(0);
  });
  it('caps the layer at remaining capacity before applying placed share',()=>{
    const result=assessLoss({...position,eligibleLoss:40_000_000,availableLimit:6_000_000,share:80},ridgecrest);
    expect(result.recovery).toBe(4_800_000);expect(result.retainedLoss).toBe(35_200_000);
  });
  it('caps at the original layer limit and handles exhausted protection',()=>{
    expect(assessLoss({...position,eligibleLoss:40_000_000},ridgecrest).recovery).toBe(15_000_000);
    expect(assessLoss({...position,availableLimit:0},ridgecrest).recovery).toBe(0);
  });
  it('distinguishes outside coverage from an in-coverage non-attachment',()=>{
    expect(assessLoss({...position,inception:'2020-01-01',expiry:'2020-12-31'},ridgecrest)).toMatchObject({outsideCoverage:true,recovery:0,retainedLoss:20_000_000});
    expect(assessLoss({...position,inception:'2019-07-06',expiry:'2019-07-06'},ridgecrest).outsideCoverage).toBe(false);
  });
  it('rounds placed recovery to cents without losing the loss reconciliation',()=>{
    const result=assessLoss({...position,eligibleLoss:0.05,retention:0,share:50},ridgecrest);
    expect(result.recovery).toBe(0.03);expect(result.retainedLoss).toBe(0.02);
  });
  it.each([{eligibleLoss:NaN},{eligibleLoss:Infinity},{eligibleLoss:-1},{eligibleLoss:0.001},{eligibleLoss:undefined},{share:0},{share:101},{availableLimit:16_000_000},{confirmed:false},{source:''},{expiry:'2018-12-31'}])('rejects missing or unsupported inputs %j',patch=>{
    expect(lossPositionSchema.safeParse({...position,...patch}).success).toBe(false);
  });
  it('rejects invalid event dates and estimates preceding the event',()=>{
    expect(()=>assessLoss(position,{...ridgecrest,occurredAt:'bad'})).toThrow('valid occurrence date');
    expect(()=>assessLoss({...position,valuationDate:'2019-07-05'},ridgecrest)).toThrow('cannot precede');
  });
  it('rejects stored results that do not reproduce',()=>{
    const snapshot={format:'catlas-event-recovery',schemaVersion:1,id:'cbe7711c-c77b-40e4-801f-df3d751828ed',caseKey:recoveryCaseKey(ridgecrest,position),version:1,reviewedAt:'2026-10-20T12:00:00.000Z',event:ridgecrest,position,result:assessLoss(position,ridgecrest),reviewNotes:''};
    expect(verifySnapshot(snapshot).result.recovery).toBe(10_000_000);
    expect(()=>verifySnapshot({...snapshot,result:{...snapshot.result,recovery:1}})).toThrow('does not reproduce');
  });
});
