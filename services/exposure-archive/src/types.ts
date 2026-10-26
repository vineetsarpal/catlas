export type Artifact = { sha256: string; bytes: number; sourceUrl: string; path: string; contentType: string };
export type Capture = {
  schemaVersion: 1;
  event: { id: string; aliases: string[]; name: string; occurredAt: string; updatedAt: string };
  product: { id: string; source: string; code: string; updatedAt: string; retrospective: boolean };
  capturedAt: string;
  artifacts: { detail: Artifact; grid: Artifact };
};
export type CaptureLimits = { maxCaptureAttempts: number; maxObjectBytes: number; backupReserve: number };
export type ArchiveUsage = {
  databaseBytes: number; reservedArtifactBytes: number; referencedArtifactBytes: number;
  abandonedArtifactBytes: number; recordedBackupBytes: number; captureAttemptsToday: number; maintenanceRequestsToday: number; usageDate: string;
};
/** External persistence boundary. Implementations must atomically admit a single proof capture. */
export interface ArchiveDatabase {
  lookup(eventId: string): Promise<Capture | null>;
  usage(): Promise<ArchiveUsage>;
  setBackupUsage(owner: string, bytes: number, maxObjectBytes: number, backupReserve: number): Promise<void>;
  acquireMaintenance(owner: string, maxDatabaseBytes: number, maxRequests: number): Promise<boolean>;
  acquire(owner: string, maxDatabaseBytes: number, eventId?: string, limits?: CaptureLimits): Promise<boolean>;
  status(eventId: string): Promise<'pending' | 'interrupted' | null>;
  orphanCandidates(owner: string, limit: number): Promise<Array<{ sha256: string; bytes: number }>>;
  recordOrphan(owner: string, sha256: string, state: 'present' | 'missing' | 'invalid'): Promise<void>;
  release(owner: string): Promise<void>;
  reserve(owner: string, artifacts: Artifact[], maxObjectBytes: number, backupReserve: number): Promise<void>;
  publish(owner: string, capture: Capture): Promise<void>;
  associate(owner: string, requestedEvent: string, canonicalEvent: string): Promise<void>;
  referencedArtifact(sha256: string): Promise<Artifact | null>;
}
export interface ObjectBucket {
  head(key: string): Promise<{ size: number; checksums: { sha256?: ArrayBuffer } } | null>;
  put(key: string, value: ArrayBuffer | ReadableStream<Uint8Array>, options: { sha256: string; httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array>; checksums: { sha256?: ArrayBuffer } } | null>;
}
export interface ArchiveDependencies { database: ArchiveDatabase; bucket: ObjectBucket; providerFetch: typeof fetch; rateLimit: (kind: 'read' | 'mutation') => Promise<boolean> }
export class ArchiveError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) { super(message); }
}
