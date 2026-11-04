import { z } from 'zod';
const coordinate = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export const eventSchema = z.object({ schemaVersion: z.literal(1), id: z.string().min(1), name: z.string(), evidenceVersion: z.string().min(1), magnitude: z.number().min(0).max(10), magnitudeType: z.literal('mw'), occurredAt: z.iso.datetime(), ...coordinate.shape, provenance: z.record(z.string(), z.unknown()) });
export const eventInputSchema = eventSchema.partial().extend({
 magnitude: z.number().nullable().optional(), magnitudeType: z.string().nullable().optional(),
 occurredAt: z.string().nullable().optional(), latitude: z.number().nullable().optional(), longitude: z.number().nullable().optional(),
});
export type EventInput = z.infer<typeof eventInputSchema>;
export type EventEvidence = z.infer<typeof eventSchema>;

export function sameRecoveryEvent(left: EventInput | null | undefined, right: EventInput | null | undefined): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]));
    return value;
  };
  return Boolean(left && right && JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)));
}
