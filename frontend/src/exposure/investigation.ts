import { assessExposure, investigationSchema, portfolioSchema, SAMPLER_VERSION, settingsSchema, sha256,
  type CapturedEvidence, type Earthquake, type Investigation, type Portfolio, type PortfolioReference } from './model';

export function eventFromEvidence(evidence: CapturedEvidence): Earthquake {
  const m = evidence.manifest;
  return { id: m.eventId, name: m.eventName, magnitude: m.magnitude, longitude: m.longitude, latitude: m.latitude, occurredAt: m.occurredAt, updatedAt: m.productUpdatedAt };
}
export async function investigate(input: { event: Earthquake; portfolio: Portfolio; evidence: CapturedEvidence | null; threshold: number;
  unavailableReason?: string; previous?: Investigation | null; portfolioReference?: PortfolioReference }): Promise<Investigation> {
  const portfolio = portfolioSchema.parse(input.portfolio), settings = settingsSchema.parse({ threshold: input.threshold, sampler: SAMPLER_VERSION });
  const prior=input.previous;
  const sameEvent=prior&&(prior.event.id===input.event.id||Boolean(input.evidence&&input.evidence.manifest.eventId===input.event.id&&input.evidence.manifest.aliases.includes(prior.event.id))||Boolean(prior.evidence&&prior.evidence.eventId===prior.event.id&&prior.evidence.aliases.includes(input.event.id)));
  const previous = sameEvent ? prior : null;
  const assessment = assessExposure(portfolio, input.evidence?.grid ?? null, settings);
  return investigationSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), caseId: previous?.caseId ?? crypto.randomUUID(),
    version: (previous?.version ?? 0) + 1, previousId: previous?.id ?? null, createdAt: new Date().toISOString(),
    event: input.event, portfolio, ...(input.portfolioReference ? { portfolioReference: input.portfolioReference } : {}), portfolioHash: await sha256(JSON.stringify(portfolio)), settings,
    evidence: input.evidence?.manifest ?? null, unavailableReason: input.evidence ? null : input.unavailableReason || 'Shaking evidence is unavailable.', ...assessment });
}
export async function verifyInvestigation(raw: unknown): Promise<Investigation> {
  const record = investigationSchema.parse(raw);
  if (record.evidence) {
    const event = record.event, evidence = record.evidence;
    if (![evidence.eventId, ...evidence.aliases].includes(event.id) || event.occurredAt !== evidence.occurredAt ||
        event.magnitude !== evidence.magnitude || event.longitude !== evidence.longitude || event.latitude !== evidence.latitude)
      throw new Error('Investigation event does not match its frozen evidence.');
  }
  if (await sha256(JSON.stringify(record.portfolio)) !== record.portfolioHash) throw new Error('Portfolio integrity check failed.');
  return record;
}
