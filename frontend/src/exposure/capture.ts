import type { CapturedEvidence, Earthquake } from './model';

export type EarthquakeCapture = { event: Earthquake; evidence: CapturedEvidence | null; reason: string | null };
