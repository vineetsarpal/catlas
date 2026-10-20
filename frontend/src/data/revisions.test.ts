import { describe, expect, it } from 'vitest';
import { capturedReference, simulatedObservation, revisedTerms, missingCoverageRevisedTerms } from './revisions';
import { mainContract, ridgecrest } from './fixtures';
import { createPacket, emptyLifecycle, evaluate, serializePacket } from '../domain/packets';

describe('versioned sensitivity and fictional RAS input replacements',()=>{
 it('distinguishes simulated evidence from its unchanged captured reference',()=>{
  expect(simulatedObservation.id).toBe(ridgecrest.id);
  for(const field of ['latitude','longitude','occurredAt','magnitudeType'] as const)expect(simulatedObservation[field]).toBe(ridgecrest[field]);
  expect(simulatedObservation.provenance.kind).toBe('simulation');
  expect(simulatedObservation.provenance.baseCapturedReference).toEqual({eventId:ridgecrest.id,evidenceVersion:ridgecrest.evidenceVersion});
  expect(simulatedObservation.provenance).not.toHaveProperty('capturedAt');expect(simulatedObservation.provenance).not.toHaveProperty('files');
  expect(simulatedObservation.evidenceVersion).not.toBe(ridgecrest.evidenceVersion);
 });
 it('preserves prior reviewed packets and links fresh evaluations through evidence, zero and incomplete revisions',()=>{
  let serial=0;const runtime={id:()=>`fixture-${++serial}`,now:()=> '2026-10-16T12:00:00.000Z'};
  let state=evaluate(emptyLifecycle(),simulatedObservation,mainContract,runtime);
  const first=state.evaluations[0];expect(first.assessment.amount).toBe(4000000);
  state=createPacket(state,first.id,'Simulation review',runtime);const original=serializePacket(state.packets[0]);
  state=evaluate(state,capturedReference,mainContract,runtime);
  const reference=state.evaluations.at(-1)!;expect(reference.assessment.amount).toBe(6000000);
  expect(reference.version).toBe(2);expect(reference.previousEvaluationId).toBe(first.id);
  expect(state.packets.some(p=>p.evaluation.id===reference.id)).toBe(false);
  state=createPacket(state,reference.id,'Captured reference review',runtime);
  expect(state.packets[1].evaluation.event).toEqual(ridgecrest);
  expect(state.packets[1].evaluation.previousEvaluationId).toBe(first.id);
  state=evaluate(state,capturedReference,revisedTerms,runtime);
  const zero=state.evaluations.at(-1)!;expect(zero.assessment.amount).toBe(0);expect(zero.version).toBe(3);expect(zero.previousEvaluationId).toBe(reference.id);
  expect(zero.contract.id).toBe(mainContract.id);expect(zero.contract.version).toBe(3);
  expect(state.packets.some(p=>p.evaluation.id===zero.id)).toBe(false);
  state=createPacket(state,zero.id,'Zero correction review',runtime);
  state=evaluate(state,capturedReference,missingCoverageRevisedTerms,runtime);
  expect(state.evaluations.at(-1)!.assessment.amount).toBeNull();
  expect(state.evaluations.at(-1)!.previousEvaluationId).toBe(zero.id);
  expect(serializePacket(state.packets[0])).toBe(original);
 });
});
