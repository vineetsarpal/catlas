-- Rerunnable additive migration for the disposable archive. No portfolio or case data belongs here.
-- Artifact reservations survive failed writes; they continue to consume the proof budget.
CREATE TABLE IF NOT EXISTS catlas_proof_capture_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner uuid,
  expires_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO catlas_proof_capture_lease(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS catlas_proof_artifacts (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint NOT NULL CHECK (bytes > 0),
  reserved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catlas_proof_captures (
  event_id text PRIMARY KEY,
  detail_sha256 text NOT NULL REFERENCES catlas_proof_artifacts(sha256),
  grid_sha256 text NOT NULL REFERENCES catlas_proof_artifacts(sha256),
  manifest jsonb NOT NULL,
  captured_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS catlas_proof_aliases (
  alias text PRIMARY KEY,
  event_id text NOT NULL REFERENCES catlas_proof_captures(event_id)
);
CREATE INDEX IF NOT EXISTS catlas_proof_alias_event_idx ON catlas_proof_aliases(event_id);
-- One latest attempt per requested event keeps retries from creating an unbounded history.
CREATE TABLE IF NOT EXISTS catlas_proof_attempts (
  event_id text PRIMARY KEY,
  owner uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('pending', 'interrupted', 'completed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);
-- Classification never removes reservations or objects. Expired writers can still finish late.
CREATE TABLE IF NOT EXISTS catlas_proof_artifact_reconciliation (
  sha256 text PRIMARY KEY REFERENCES catlas_proof_artifacts(sha256),
  last_owner uuid,
  state text CHECK (state IN ('present', 'missing', 'invalid')),
  reconciled_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO catlas_proof_artifact_reconciliation(sha256)
  SELECT sha256 FROM catlas_proof_artifacts ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION catlas_proof_acquire(request_owner uuid, database_limit bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE acquired boolean;
BEGIN
  -- Reserve room for the small manifest/index writes and aborted-attempt bookkeeping.
  IF pg_database_size(current_database()) + 2000000 > database_limit THEN
    RAISE EXCEPTION 'catlas_database_capacity';
  END IF;
  UPDATE catlas_proof_capture_lease SET owner = request_owner, expires_at = clock_timestamp() + interval '3 minutes'
    WHERE singleton AND (owner IS NULL OR expires_at < clock_timestamp()) RETURNING true INTO acquired;
  RETURN coalesce(acquired, false);
END $$;
-- Keep the old overload during rolling deployment; new callers supply their requested ID.
CREATE OR REPLACE FUNCTION catlas_proof_acquire(request_owner uuid, database_limit bigint, requested_event text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF NOT catlas_proof_acquire(request_owner, database_limit) THEN RETURN false; END IF;
  IF requested_event IS NULL THEN RETURN true; END IF;
  INSERT INTO catlas_proof_attempts(event_id, owner, state, started_at, finished_at)
    VALUES (requested_event, request_owner, 'pending', clock_timestamp(), NULL)
    ON CONFLICT (event_id) DO UPDATE SET owner = EXCLUDED.owner, state = 'pending', started_at = EXCLUDED.started_at, finished_at = NULL;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_status(requested_event text)
RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN a.state = 'completed' THEN NULL
    WHEN a.state = 'pending' AND l.owner = a.owner AND l.expires_at > clock_timestamp() THEN 'pending'
    ELSE 'interrupted' END
  FROM catlas_proof_attempts a CROSS JOIN catlas_proof_capture_lease l
  WHERE a.event_id = requested_event AND l.singleton
$$;
CREATE OR REPLACE FUNCTION catlas_proof_release(request_owner uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Cleanup is idempotent even after expiry; a stale owner can never release a newer lease.
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE catlas_proof_attempts SET state = 'interrupted', finished_at = clock_timestamp()
    WHERE owner = request_owner AND state = 'pending';
  UPDATE catlas_proof_capture_lease SET owner = NULL, expires_at = '-infinity'
    WHERE singleton AND owner = request_owner;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_reserve(request_owner uuid, incoming jsonb, object_limit bigint, backup_reserve bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE additional bigint; used bigint;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  SELECT coalesce(sum(bytes), 0) INTO used FROM catlas_proof_artifacts;
  SELECT coalesce(sum(a.bytes), 0) INTO additional
    FROM (SELECT DISTINCT (value->>'sha256') AS sha256, (value->>'bytes')::bigint AS bytes FROM jsonb_array_elements(incoming)) a
    WHERE NOT EXISTS (SELECT 1 FROM catlas_proof_artifacts b WHERE b.sha256 = a.sha256);
  IF used + additional + greatest(backup_reserve, (SELECT bytes FROM catlas_proof_backup_usage WHERE singleton)) > object_limit THEN RAISE EXCEPTION 'catlas_object_capacity'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(incoming) a JOIN catlas_proof_artifacts b ON b.sha256 = a->>'sha256' WHERE b.bytes <> (a->>'bytes')::bigint) THEN
    RAISE EXCEPTION 'catlas_artifact_conflict';
  END IF;
  INSERT INTO catlas_proof_artifacts(sha256, bytes)
    SELECT DISTINCT value->>'sha256', (value->>'bytes')::bigint FROM jsonb_array_elements(incoming) ON CONFLICT DO NOTHING;
  INSERT INTO catlas_proof_artifact_reconciliation(sha256, last_owner)
    SELECT DISTINCT value->>'sha256', request_owner FROM jsonb_array_elements(incoming)
    ON CONFLICT (sha256) DO UPDATE SET last_owner = EXCLUDED.last_owner;
END $$;
-- Attach a newly observed requested ID without changing the frozen capture manifest.
CREATE OR REPLACE FUNCTION catlas_proof_associate(request_owner uuid, requested_event text, canonical_event text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  PERFORM 1 FROM catlas_proof_attempts WHERE owner = request_owner AND event_id = requested_event AND state = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM catlas_proof_captures WHERE event_id = canonical_event)
    OR EXISTS (SELECT 1 FROM catlas_proof_aliases WHERE alias = requested_event AND event_id <> canonical_event)
    OR EXISTS (SELECT 1 FROM catlas_proof_captures WHERE event_id = requested_event AND event_id <> canonical_event) THEN
    RAISE EXCEPTION 'catlas_alias_conflict';
  END IF;
  INSERT INTO catlas_proof_aliases(alias, event_id) VALUES(requested_event, canonical_event) ON CONFLICT DO NOTHING;
  UPDATE catlas_proof_attempts SET state = 'completed', finished_at = clock_timestamp()
    WHERE owner = request_owner AND state = 'pending';
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_publish(request_owner uuid, capture jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE alias_id text; requested_event text;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  INSERT INTO catlas_proof_captures(event_id, detail_sha256, grid_sha256, manifest, captured_at)
    VALUES (capture->'event'->>'id', capture->'artifacts'->'detail'->>'sha256', capture->'artifacts'->'grid'->>'sha256', capture, (capture->>'capturedAt')::timestamptz);
  FOR alias_id IN SELECT jsonb_array_elements_text(capture->'event'->'aliases') LOOP
    IF EXISTS (SELECT 1 FROM catlas_proof_aliases WHERE alias = alias_id AND event_id <> capture->'event'->>'id')
      OR EXISTS (SELECT 1 FROM catlas_proof_captures WHERE event_id = alias_id AND event_id <> capture->'event'->>'id') THEN
      RAISE EXCEPTION 'catlas_alias_conflict';
    END IF;
    INSERT INTO catlas_proof_aliases(alias,event_id) VALUES(alias_id,capture->'event'->>'id') ON CONFLICT DO NOTHING;
  END LOOP;
  SELECT event_id INTO requested_event FROM catlas_proof_attempts WHERE owner = request_owner AND state = 'pending';
  IF requested_event IS NOT NULL THEN
    PERFORM catlas_proof_associate(request_owner, requested_event, capture->'event'->>'id');
  END IF;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_orphan_candidates(request_owner uuid, requested_limit integer)
RETURNS TABLE(sha256 text, bytes bigint) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  RETURN QUERY SELECT a.sha256, a.bytes
    FROM catlas_proof_artifacts a JOIN catlas_proof_artifact_reconciliation r ON r.sha256 = a.sha256
    WHERE NOT EXISTS (SELECT 1 FROM catlas_proof_captures c WHERE c.detail_sha256 = a.sha256 OR c.grid_sha256 = a.sha256)
      AND NOT EXISTS (SELECT 1 FROM catlas_proof_capture_lease l WHERE l.singleton AND l.owner = r.last_owner AND l.expires_at > clock_timestamp())
    ORDER BY r.reconciled_at, a.reserved_at, a.sha256
    LIMIT greatest(0, least(coalesce(requested_limit, 0), 16));
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_record_orphan(request_owner uuid, artifact_hash text, observed_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  UPDATE catlas_proof_artifact_reconciliation r SET state = observed_state, reconciled_at = clock_timestamp()
    WHERE r.sha256 = artifact_hash
      AND NOT EXISTS (SELECT 1 FROM catlas_proof_captures c WHERE c.detail_sha256 = r.sha256 OR c.grid_sha256 = r.sha256)
      AND NOT EXISTS (SELECT 1 FROM catlas_proof_capture_lease l WHERE l.singleton AND l.owner = r.last_owner AND l.expires_at > clock_timestamp());
END $$;

-- CAT-47 budget bookkeeping stays constant-size; dates reset only on explicit admission.
CREATE TABLE IF NOT EXISTS catlas_proof_backup_usage (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0)
);
INSERT INTO catlas_proof_backup_usage(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS catlas_proof_daily_usage (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  usage_date date NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')::date,
  capture_attempts bigint NOT NULL DEFAULT 0 CHECK (capture_attempts >= 0)
);
INSERT INTO catlas_proof_daily_usage(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION catlas_proof_usage()
RETURNS TABLE(database_bytes bigint, reserved_artifact_bytes bigint, referenced_artifact_bytes bigint,
  abandoned_artifact_bytes bigint, recorded_backup_bytes bigint, capture_attempts_today bigint, usage_date text)
LANGUAGE sql AS $$
  WITH amounts AS (
    SELECT coalesce(sum(a.bytes), 0)::bigint AS reserved,
      coalesce(sum(a.bytes) FILTER (WHERE EXISTS (
        SELECT 1 FROM catlas_proof_captures c WHERE c.detail_sha256 = a.sha256 OR c.grid_sha256 = a.sha256
      )), 0)::bigint AS referenced
    FROM catlas_proof_artifacts a
  )
  SELECT pg_database_size(current_database()), amounts.reserved, amounts.referenced,
    amounts.reserved - amounts.referenced, b.bytes,
    CASE WHEN d.usage_date = (clock_timestamp() AT TIME ZONE 'UTC')::date THEN d.capture_attempts ELSE 0 END,
    ((clock_timestamp() AT TIME ZONE 'UTC')::date)::text
  FROM amounts CROSS JOIN catlas_proof_backup_usage b CROSS JOIN catlas_proof_daily_usage d
  WHERE b.singleton AND d.singleton
$$;

-- Admission charges an attempt before source work. Exceptions roll back lease and bookkeeping.
CREATE OR REPLACE FUNCTION catlas_proof_admit(request_owner uuid, database_limit bigint, requested_event text,
  attempt_limit bigint, object_limit bigint, backup_reserve bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE used bigint; current_attempts bigint; today date;
BEGIN
  IF NOT catlas_proof_acquire(request_owner, database_limit, requested_event) THEN RETURN false; END IF;
  SELECT coalesce(sum(bytes), 0) INTO used FROM catlas_proof_artifacts;
  IF used + greatest(backup_reserve, (SELECT bytes FROM catlas_proof_backup_usage WHERE singleton)) >= object_limit THEN
    RAISE EXCEPTION 'catlas_object_capacity';
  END IF;
  today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  SELECT CASE WHEN usage_date = today THEN capture_attempts ELSE 0 END INTO current_attempts
    FROM catlas_proof_daily_usage WHERE singleton;
  IF current_attempts >= attempt_limit THEN RAISE EXCEPTION 'catlas_usage_limit'; END IF;
  UPDATE catlas_proof_daily_usage SET usage_date = today, capture_attempts = current_attempts + 1 WHERE singleton;
  RETURN true;
END $$;

-- Declare the backup allocation before a future uploader writes bytes. Never silently reclaim it.
CREATE OR REPLACE FUNCTION catlas_proof_set_backup_usage(request_owner uuid, incoming_bytes bigint,
  object_limit bigint, backup_reserve bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE used bigint; previous_bytes bigint;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  SELECT bytes INTO previous_bytes FROM catlas_proof_backup_usage WHERE singleton;
  IF incoming_bytes < 0 OR incoming_bytes IS NULL THEN RAISE EXCEPTION 'catlas_backup_invalid'; END IF;
  IF incoming_bytes < previous_bytes THEN RAISE EXCEPTION 'catlas_backup_decrease'; END IF;
  SELECT coalesce(sum(bytes), 0) INTO used FROM catlas_proof_artifacts;
  IF used + greatest(backup_reserve, incoming_bytes) > object_limit THEN RAISE EXCEPTION 'catlas_object_capacity'; END IF;
  UPDATE catlas_proof_backup_usage SET bytes = incoming_bytes WHERE singleton;
END $$;

-- A separate maintenance allowance bounds reconciliation work without consuming capture attempts.
CREATE TABLE IF NOT EXISTS catlas_proof_daily_maintenance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  usage_date date NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')::date,
  requests bigint NOT NULL DEFAULT 0 CHECK (requests >= 0)
);
INSERT INTO catlas_proof_daily_maintenance(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION catlas_proof_admit_maintenance(request_owner uuid, database_limit bigint, request_limit bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE current_requests bigint; today date;
BEGIN
  IF NOT catlas_proof_acquire(request_owner, database_limit) THEN RETURN false; END IF;
  today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  SELECT CASE WHEN usage_date = today THEN requests ELSE 0 END INTO current_requests
    FROM catlas_proof_daily_maintenance WHERE singleton;
  IF current_requests >= request_limit THEN RAISE EXCEPTION 'catlas_maintenance_usage_limit'; END IF;
  UPDATE catlas_proof_daily_maintenance SET usage_date = today, requests = current_requests + 1 WHERE singleton;
  RETURN true;
END $$;
