import { assessExposure, investigationSchema, portfolioSchema, SAMPLER_VERSION, settingsSchema, sha256,
  type CapturedEvidence, type Earthquake, type Investigation, type Portfolio } from './model';

export function eventFromEvidence(evidence: CapturedEvidence): Earthquake {
  const m = evidence.manifest;
  return { id: m.eventId, name: m.eventName, magnitude: m.magnitude, longitude: m.longitude, latitude: m.latitude, occurredAt: m.occurredAt, updatedAt: m.productUpdatedAt };
}
export async function investigate(input: { event: Earthquake; portfolio: Portfolio; evidence: CapturedEvidence | null; threshold: number;
  unavailableReason?: string; previous?: Investigation | null }): Promise<Investigation> {
  const portfolio = portfolioSchema.parse(input.portfolio), settings = settingsSchema.parse({ threshold: input.threshold, sampler: SAMPLER_VERSION });
  const previous = input.previous?.event.id === input.event.id ? input.previous : null;
  const assessment = assessExposure(portfolio, input.evidence?.grid ?? null, settings);
  return investigationSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), caseId: previous?.caseId ?? crypto.randomUUID(),
    version: (previous?.version ?? 0) + 1, previousId: previous?.id ?? null, createdAt: new Date().toISOString(),
    event: input.event, portfolio, portfolioHash: await sha256(JSON.stringify(portfolio)), settings,
    evidence: input.evidence?.manifest ?? null, unavailableReason: input.evidence ? null : input.unavailableReason || 'Shaking evidence is unavailable.', ...assessment });
}
export async function verifyInvestigation(raw: unknown): Promise<Investigation> {
  const record = investigationSchema.parse(raw);
  if (await sha256(JSON.stringify(record.portfolio)) !== record.portfolioHash) throw new Error('Portfolio integrity check failed.');
  return record;
}
