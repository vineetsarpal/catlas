export type Artifact = { sha256: string; bytes: number; sourceUrl: string; path: string; contentType: string };
export type Capture = {
  schemaVersion: 1;
  event: { id: string; aliases: string[]; name: string; occurredAt: string; updatedAt: string };
  product: { id: string; source: string; code: string; updatedAt: string; retrospective: boolean };
  capturedAt: string;
  artifacts: { detail: Artifact; grid: Artifact };
};
export type CleanupPlan = { planId: string; confirmation: string; expiresAt: string; state: 'preview' | 'confirmed' | 'completed'; artifacts: Array<{ sha256: string; bytes: number; objectKey: string; state: 'pending' | 'deleting' | 'deleted' | 'skipped' }>; logs: Array<{ eventId: string }>; createdAt: string };
export type CaptureLimits = { maxCaptureAttempts: number; maxObjectBytes: number; backupReserve: number };
export type ArchiveUsage = {
  databaseBytes: number; reservedArtifactBytes: number; referencedArtifactBytes: number;
  abandonedArtifactBytes: number; recordedBackupBytes: number; captureAttemptsToday: number; maintenanceRequestsToday: number; usageDate: string;
};
export type RecoveryObject = { key: string; sha256: string; bytes: number; state: 'pending'|'verified'|'deleting'|'deleted'; kind: 'content'|'manifest' };
export type RecoveryJob = { id: string; state: 'building'|'complete'|'failed'|'expired'|'restoring'; createdAt: string; completedAt?: string; error?: string; snapshot: Record<string, unknown[]>; artifacts: Array<{sha256:string;bytes:number;sourceKey:string;backupKey?:string;restored?:boolean}>; manifestKey?:string; manifestSha256?:string; manifestBytes?:number; };
/** External persistence boundary. Implementations must atomically admit a single proof capture. */
export interface ArchiveDatabase {
  recoveryGate?(owner:string):Promise<void>;
  recoverySnapshot?(owner:string):Promise<Record<string,unknown[]>>;
  recoveryStart?(owner:string,job:RecoveryJob,restore:boolean):Promise<RecoveryJob>;
  recoveryGet?(id:string,restore:boolean):Promise<RecoveryJob|null>;
  recoveryInventory?():Promise<RecoveryJob[]>;
  recoverySave?(owner:string,job:RecoveryJob,restore:boolean):Promise<void>;
  recoveryObject?(sha256:string):Promise<RecoveryObject|null>;
  recoveryReserve?(owner:string,object:RecoveryObject,maxBytes:number,reserve:number):Promise<void>;
  recoveryObjectState?(owner:string,key:string,state:'verified'|'deleting'|'deleted'):Promise<void>;
  recoveryRotate?(owner:string):Promise<RecoveryObject[]>;
  recoveryPublish?(owner:string,job:RecoveryJob):Promise<void>;
  objectKey?(sha256: string): Promise<string>;
  artifactState?(sha256: string): Promise<'present' | 'deleting' | 'deleted'>;
  cleanupConfirm?(owner: string, planId: string, confirmation: string): Promise<CleanupPlan>;
  cleanupClaim?(owner: string, planId: string, sha256: string): Promise<boolean>;
  cleanupComplete?(owner: string, planId: string, sha256: string): Promise<void>;
  cleanupStatus?(planId: string): Promise<CleanupPlan | null>;
  cleanupRetention?(owner: string, sha256: string, retain: boolean): Promise<void>;
  cleanupPreview?(owner: string, planId: string, confirmation: string): Promise<CleanupPlan>;
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
  delete?(key: string): Promise<unknown>;
  head(key: string): Promise<{ size: number; checksums: { sha256?: ArrayBuffer } } | null>;
  put(key: string, value: ArrayBuffer | ReadableStream<Uint8Array>, options: { sha256: string; httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array>; checksums: { sha256?: ArrayBuffer } } | null>;
}
export interface ArchiveDependencies { database: ArchiveDatabase; bucket: ObjectBucket; providerFetch: typeof fetch; rateLimit: (kind: 'read' | 'mutation') => Promise<boolean> }
export class ArchiveError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) { super(message); }
}
