import { neon } from '@neondatabase/serverless';
import { providerFailure } from './provider-errors';
import { ArchiveError, type ArchiveDatabase, type Artifact, type Capture } from './types';

/** Neon HTTP operations are request-driven. No pool, timer, heartbeat or background collector. */
export function createNeonDatabase(connectionString: string): ArchiveDatabase {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') throw new ArchiveError('configuration_error', 'The database connection is not configured.', 503);
  if (!parsed.hostname.endsWith('.neon.tech')) throw new ArchiveError('configuration_error', 'The proof requires a disposable Neon database.', 503);
  // One HTTP query client per request; constructing it performs no network I/O.
  // query() supports operation-specific fetchOptions, preserving a fresh timeout.
  const sql = neon(connectionString);
  async function query(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Database query deadline exceeded.', 'TimeoutError')), 15_000);
    try { return await sql.query(text, params, { fetchOptions: { signal: controller.signal } }); }
    finally { clearTimeout(timeout); }
  }
  return createPostgresDatabase(query);
}

export type PostgresQuery = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
/** Production SQL mapping, also usable with a disposable local PostgreSQL transport. */
export function createPostgresDatabase(transport: PostgresQuery): ArchiveDatabase {
  async function query(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    try { return await transport(text, params); }
    catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('catlas_database_capacity') || message.includes('catlas_object_capacity')) throw new ArchiveError('capacity_exceeded', 'The proof storage budget was reached. Existing captures remain readable where services permit.', 507);
      if (message.includes('catlas_backup_decrease') || message.includes('catlas_backup_invalid')) throw new ArchiveError('invalid_request', 'Backup allocation cannot be reduced without a separately verified cleanup procedure.', 400);
      if (message.includes('catlas_maintenance_usage_limit')) throw new ArchiveError('usage_limit', 'The archive maintenance allowance for today was reached. Existing captures remain readable. Retry explicitly after the next UTC day.', 429);
      if (message.includes('catlas_usage_limit')) throw new ArchiveError('usage_limit', 'The archive capture allowance for today was reached. Existing captures remain readable. Retry explicitly after the next UTC day.', 429);
      if (message.includes('catlas_lease_lost')) throw new ArchiveError('capture_interrupted', 'This capture lease expired. Retry explicitly; incomplete evidence is not available.', 409);
      if (message.includes('catlas_alias_conflict') || message.includes('catlas_artifact_conflict')) throw new ArchiveError('identity_conflict', 'Source identity or artifact metadata conflicts with a retained capture.', 409);
      const providerError = providerFailure(e, 'Neon');
      if (providerError) throw providerError;
      throw new ArchiveError('database_unavailable', 'The public metadata database is unavailable. Retry explicitly.', 503);
    }
  }
  return {
    async usage() {
      const rows = await query("SELECT u.*, CASE WHEN m.usage_date = (statement_timestamp() AT TIME ZONE 'UTC')::date THEN m.requests ELSE 0 END AS maintenance_requests_today FROM catlas_proof_usage() u CROSS JOIN catlas_proof_daily_maintenance m WHERE m.singleton", []);
      const row = rows[0];
      return {
        databaseBytes: Number(row.database_bytes), reservedArtifactBytes: Number(row.reserved_artifact_bytes),
        referencedArtifactBytes: Number(row.referenced_artifact_bytes), abandonedArtifactBytes: Number(row.abandoned_artifact_bytes),
        recordedBackupBytes: Number(row.recorded_backup_bytes), captureAttemptsToday: Number(row.capture_attempts_today), maintenanceRequestsToday: Number(row.maintenance_requests_today), usageDate: String(row.usage_date),
      };
    },
    async setBackupUsage(owner, bytes, maxObjectBytes, backupReserve) {
      await query('SELECT catlas_proof_set_backup_usage($1::uuid, $2::bigint, $3::bigint, $4::bigint)', [owner, bytes, maxObjectBytes, backupReserve]);
    },
    async lookup(eventId) {
      const rows = await query('SELECT c.manifest FROM catlas_proof_captures c WHERE c.event_id = $1 OR EXISTS (SELECT 1 FROM catlas_proof_aliases a WHERE a.alias = $1 AND a.event_id = c.event_id) LIMIT 1', [eventId]);
      return rows.length ? rows[0].manifest as Capture : null;
    },
    async acquireMaintenance(owner, maxDatabaseBytes, maxRequests) {
      const rows = await query('SELECT catlas_proof_admit_maintenance($1::uuid, $2::bigint, $3::bigint) AS acquired', [owner, maxDatabaseBytes, maxRequests]);
      return rows[0].acquired === true;
    },
    async acquire(owner, maxDatabaseBytes, eventId, limits) {
      const rows = limits
        ? await query('SELECT catlas_proof_admit($1::uuid, $2::bigint, $3::text, $4::bigint, $5::bigint, $6::bigint) AS acquired', [owner, maxDatabaseBytes, eventId ?? null, limits.maxCaptureAttempts, limits.maxObjectBytes, limits.backupReserve])
        : await query('SELECT catlas_proof_acquire($1::uuid, $2::bigint, $3::text) AS acquired', [owner, maxDatabaseBytes, eventId ?? null]);
      return rows[0].acquired === true;
    },
    async release(owner) { await query('SELECT catlas_proof_release($1::uuid)', [owner]); },
    async status(eventId) {
      const rows = await query('SELECT catlas_proof_status($1::text) AS status', [eventId]);
      return rows[0]?.status === 'pending' ? 'pending' : rows[0]?.status === 'interrupted' ? 'interrupted' : null;
    },
    async orphanCandidates(owner, limit) {
      const rows = await query('SELECT sha256, bytes FROM catlas_proof_orphan_candidates($1::uuid, $2::integer)', [owner, limit]);
      return rows.map(row => ({ sha256: String(row.sha256), bytes: Number(row.bytes) }));
    },
    async recordOrphan(owner, sha256, state) {
      await query('SELECT catlas_proof_record_orphan($1::uuid, $2::text, $3::text)', [owner, sha256, state]);
    },
    async reserve(owner, artifacts, maxObjectBytes, backupReserve) {
      await query('SELECT catlas_proof_reserve($1::uuid, $2::jsonb, $3::bigint, $4::bigint)', [owner, JSON.stringify(artifacts), maxObjectBytes, backupReserve]);
    },
    async publish(owner, capture) { await query('SELECT catlas_proof_publish($1::uuid, $2::jsonb)', [owner, JSON.stringify(capture)]); },
    async associate(owner, requestedEvent, canonicalEvent) {
      await query('SELECT catlas_proof_associate($1::uuid, $2::text, $3::text)', [owner, requestedEvent, canonicalEvent]);
    },
    async referencedArtifact(sha256) {
      const rows = await query("SELECT CASE WHEN detail_sha256 = $1 THEN manifest->'artifacts'->'detail' ELSE manifest->'artifacts'->'grid' END AS artifact FROM catlas_proof_captures WHERE detail_sha256 = $1 OR grid_sha256 = $1 LIMIT 1", [sha256]);
      return rows.length ? rows[0].artifact as Artifact : null;
    },
  };
}
