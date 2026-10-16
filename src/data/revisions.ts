import { contractSchema, eventSchema, type ContractInput } from '../domain/types';
import { mainContract, ridgecrest } from './fixtures';

export const capturedReference = ridgecrest;
// The event ID preserves the assessed earthquake lineage. This observation is
// deliberately simulated and never claims a USGS bulletin or source capture.
export const simulatedObservation = eventSchema.parse({
 ...ridgecrest,
 name: 'Ridgecrest · simulated M6.9 observation',
 magnitude: 6.9,
 evidenceVersion: 'SIM-RIDGECREST-M69-v1',
 provenance: {
  kind: 'simulation',
  declaration: 'Synthetic magnitude sensitivity observation; not a retained historical USGS bulletin or actual revision chronology.',
  baseCapturedReference: { eventId: ridgecrest.id, evidenceVersion: ridgecrest.evidenceVersion },
  modifiedFields: ['magnitude'],
  unchangedFields: ['earthquake identity for assessment lineage', 'epicentre', 'occurrence time', 'magnitude type'],
 },
});
// Fictional RAS-authored input replacements, not Catlas payout overrides. Keep
// the treaty ID stable so replacement packets belong to the same case lineage.
export const revisedTerms = contractSchema.parse({
 ...mainContract, version: 3, minimumMagnitude: 7.5,
});
export const missingCoverageRevisedTerms: ContractInput = {
 ...revisedTerms, version: 4, inception: null, expiry: null,
};
