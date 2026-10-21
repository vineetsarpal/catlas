import { z } from 'zod';
import type { EventInput } from '../domain/types';

const amount = z.number().finite().min(0).max(1e12).refine(value => value === Math.round(value * 100) / 100, 'Use at most two decimal places.');
const text = z.string().trim().min(1).max(500);
const date = z.iso.date();
export const lossPositionSchema = z.object({
  entity: text, businessLine: text, source: text, valuationDate: date,
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']), eligibleLoss: amount,
  treaty: text, inception: date, expiry: date, retention: amount,
  limit: amount.refine(value => value > 0, 'Layer limit must be positive.'),
  availableLimit: amount, share: z.number().finite().gt(0).max(100),
  confirmed: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.expiry < value.inception) ctx.addIssue({code:'custom',path:['expiry'],message:'Last covered date must follow the first covered date.'});
  if (value.availableLimit > value.limit) ctx.addIssue({code:'custom',path:['availableLimit'],message:'Available limit cannot exceed the layer limit.'});
});
export type LossPosition = z.infer<typeof lossPositionSchema>;
export type RecoveryResult = { eligibleLoss: number; aboveRetention: number; layerLoss: number; recovery: number; retainedLoss: number; outsideCoverage: boolean };

/** Single occurrence layer; both limits are at 100%, before placement share. */
export function assessLoss(position: LossPosition, event: EventInput): RecoveryResult {
  const p = lossPositionSchema.parse(position);
  if (!event.id || !event.name || !event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt))) throw new Error('Select an event with a valid occurrence date.');
  const day = new Date(event.occurredAt).toISOString().slice(0,10);
  if (p.valuationDate < day) throw new Error('Loss valuation date cannot precede the event.');
  const cents = (value: number) => Math.round(value * 100);
  const outsideCoverage = day < p.inception || day > p.expiry;
  const eligible = cents(p.eligibleLoss);
  const above = Math.max(0, eligible - cents(p.retention));
  const layer = outsideCoverage ? 0 : Math.min(above, cents(p.limit), cents(p.availableLimit));
  const recovery = Math.round(layer * p.share / 100);
  return { eligibleLoss: eligible/100, aboveRetention: above/100, layerLoss: layer/100, recovery: recovery/100, retainedLoss: (eligible-recovery)/100, outsideCoverage };
}

export const snapshotSchema = z.object({
  format: z.literal('catlas-event-recovery'), schemaVersion: z.literal(1),
  id: z.string().uuid(), caseKey: z.string(), version: z.number().int().positive(),
  reviewedAt: z.iso.datetime(), event: z.object({id:text,name:text,occurredAt:z.iso.datetime()}).passthrough(),
  position: lossPositionSchema, result: z.object({eligibleLoss:amount,aboveRetention:amount,layerLoss:amount,recovery:amount,retainedLoss:amount,outsideCoverage:z.boolean()}),
  reviewNotes: z.string().max(4000),
});
export type RecoverySnapshot = z.infer<typeof snapshotSchema>;
export function verifySnapshot(raw: unknown): RecoverySnapshot {
  const snapshot = snapshotSchema.parse(raw);
  if (snapshot.caseKey !== recoveryCaseKey(snapshot.event as EventInput, snapshot.position)) throw new Error('Saved recovery identity does not match its inputs. Records have been preserved.');
  if (JSON.stringify(assessLoss(snapshot.position, snapshot.event as EventInput)) !== JSON.stringify(snapshot.result)) throw new Error('Saved recovery does not reproduce from its inputs. Records have been preserved.');
  return snapshot;
}
export const recoveryCaseKey = (event: EventInput, p: LossPosition) => JSON.stringify([event.id,p.entity,p.businessLine,p.treaty,p.currency]);
