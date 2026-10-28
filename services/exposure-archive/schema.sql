-- Rerunnable additive migration for the disposable archive. No portfolio or case data belongs here.
-- Artifact reservations survive failed writes; they continue to consume the proof budget.
CREATE TABLE IF NOT EXISTS catlas_proof_recovery_points (
  id uuid PRIMARY KEY, state text NOT NULL, document jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS catlas_proof_recovery_objects (
  key text PRIMARY KEY, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes bigint NOT NULL CHECK(bytes>0),
  state text NOT NULL CHECK(state IN ('pending','verified','deleting','deleted')), kind text NOT NULL CHECK(kind IN ('content','manifest'))
);
CREATE TABLE IF NOT EXISTS catlas_proof_restore_jobs (id uuid PRIMARY KEY, document jsonb NOT NULL);
CREATE OR REPLACE FUNCTION catlas_proof_recovery_bytes()
RETURNS bigint LANGUAGE sql AS $$ SELECT coalesce(sum(bytes),0)::bigint FROM catlas_proof_recovery_objects WHERE state<>'deleted' $$;
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
CREATE TABLE IF NOT EXISTS catlas_proof_artifact_lifecycle (
  sha256 text PRIMARY KEY REFERENCES catlas_proof_artifacts(sha256),
  storage_key text NOT NULL,
  availability text NOT NULL DEFAULT 'present' CHECK (availability IN ('present','deleting','deleted')),
  retained boolean NOT NULL DEFAULT false,
  writer_owner uuid,
  writer_settled boolean NOT NULL DEFAULT true,
  uncertain_writes boolean NOT NULL DEFAULT false
);
INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key) SELECT sha256, 'sha256/' || sha256 FROM catlas_proof_artifacts ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS catlas_proof_captures (
  event_id text PRIMARY KEY,
  detail_sha256 text NOT NULL REFERENCES catlas_proof_artifacts(sha256),
  grid_sha256 text NOT NULL REFERENCES catlas_proof_artifacts(sha256),
  manifest jsonb NOT NULL,
  captured_at timestamptz NOT NULL
);
-- Immutable public revisions; the original captures table remains the latest pointer.
CREATE TABLE IF NOT EXISTS catlas_proof_capture_versions (
  event_id text NOT NULL,
  detail_sha256 text NOT NULL REFERENCES catlas_proof_artifacts(sha256),
  grid_sha256 text NOT NULL REFERENCES catlas_proof_artifacts(sha256),
  manifest jsonb NOT NULL,
  captured_at timestamptz NOT NULL,
  PRIMARY KEY(event_id, detail_sha256, grid_sha256, captured_at)
);
INSERT INTO catlas_proof_capture_versions SELECT * FROM catlas_proof_captures ON CONFLICT DO NOTHING;
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
  IF EXISTS(SELECT 1 FROM catlas_proof_restore_jobs WHERE document->>'state'='restoring') THEN RAISE EXCEPTION 'catlas_recovery_busy'; END IF;
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
  UPDATE catlas_proof_artifact_lifecycle SET uncertain_writes=true WHERE writer_owner=request_owner AND NOT writer_settled;
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
  SELECT coalesce(sum(a.bytes),0) INTO used FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_lifecycle l USING(sha256) WHERE coalesce(l.availability,'present')<>'deleted';
  SELECT coalesce(sum(a.bytes), 0) INTO additional
    FROM (SELECT DISTINCT (value->>'sha256') AS sha256, (value->>'bytes')::bigint AS bytes FROM jsonb_array_elements(incoming)) a
    LEFT JOIN catlas_proof_artifact_lifecycle life ON life.sha256=a.sha256
    WHERE NOT EXISTS (SELECT 1 FROM catlas_proof_artifacts b WHERE b.sha256 = a.sha256) OR life.availability='deleted';
  IF used + additional + greatest(backup_reserve, (SELECT bytes FROM catlas_proof_backup_usage WHERE singleton) + catlas_proof_recovery_bytes()) > object_limit THEN RAISE EXCEPTION 'catlas_object_capacity'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(incoming) a JOIN catlas_proof_artifacts b ON b.sha256 = a->>'sha256' WHERE b.bytes <> (a->>'bytes')::bigint) THEN
    RAISE EXCEPTION 'catlas_artifact_conflict';
  END IF;
  INSERT INTO catlas_proof_artifacts(sha256, bytes)
    SELECT DISTINCT value->>'sha256', (value->>'bytes')::bigint FROM jsonb_array_elements(incoming) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(incoming) a JOIN catlas_proof_artifact_lifecycle l ON l.sha256=a->>'sha256' WHERE l.availability='deleting') THEN RAISE EXCEPTION 'catlas_cleanup_conflict'; END IF;
  INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key,writer_owner,writer_settled)
    SELECT DISTINCT value->>'sha256', 'sha256/'||(value->>'sha256'), request_owner, false FROM jsonb_array_elements(incoming)
    ON CONFLICT(sha256) DO UPDATE SET
      storage_key=CASE WHEN catlas_proof_artifact_lifecycle.availability='deleted' THEN 'sha256/'||EXCLUDED.sha256||'/'||request_owner::text ELSE catlas_proof_artifact_lifecycle.storage_key END,
      uncertain_writes=catlas_proof_artifact_lifecycle.uncertain_writes OR (NOT catlas_proof_artifact_lifecycle.writer_settled AND catlas_proof_artifact_lifecycle.writer_owner IS DISTINCT FROM request_owner),
      availability='present', writer_owner=request_owner,writer_settled=false;
  INSERT INTO catlas_proof_artifact_reconciliation(sha256, last_owner)
    SELECT DISTINCT value->>'sha256', request_owner FROM jsonb_array_elements(incoming)
    ON CONFLICT (sha256) DO UPDATE SET last_owner = EXCLUDED.last_owner;
END $$;
-- Attach a newly observed requested ID without changing the frozen capture manifest.
CREATE OR REPLACE FUNCTION catlas_proof_associate(request_owner uuid, requested_event text, canonical_event text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  canonical_event := coalesce((SELECT event_id FROM catlas_proof_aliases WHERE alias = canonical_event), canonical_event);
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
DECLARE alias_id text; requested_event text; stable_event text; identities text[];
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  -- Source aliases may rename one retained identity, but must never merge two archives.
  SELECT array_agg(DISTINCT event_id) INTO identities FROM (
    SELECT c.event_id FROM catlas_proof_captures c WHERE c.event_id IN (SELECT jsonb_array_elements_text(capture->'event'->'aliases'))
    UNION SELECT a.event_id FROM catlas_proof_aliases a WHERE a.alias IN (SELECT jsonb_array_elements_text(capture->'event'->'aliases'))
  ) known;
  IF cardinality(identities) > 1 THEN RAISE EXCEPTION 'catlas_alias_conflict'; END IF;
  stable_event := coalesce(identities[1], capture->'event'->>'id');
  INSERT INTO catlas_proof_captures(event_id, detail_sha256, grid_sha256, manifest, captured_at)
    VALUES (stable_event, capture->'artifacts'->'detail'->>'sha256', capture->'artifacts'->'grid'->>'sha256', capture, (capture->>'capturedAt')::timestamptz)
    ON CONFLICT (event_id) DO UPDATE SET detail_sha256 = EXCLUDED.detail_sha256, grid_sha256 = EXCLUDED.grid_sha256, manifest = EXCLUDED.manifest, captured_at = EXCLUDED.captured_at;
  INSERT INTO catlas_proof_capture_versions SELECT * FROM catlas_proof_captures WHERE event_id = stable_event ON CONFLICT DO NOTHING;
  FOR alias_id IN SELECT jsonb_array_elements_text(capture->'event'->'aliases') LOOP
    IF EXISTS (SELECT 1 FROM catlas_proof_aliases WHERE alias = alias_id AND event_id <> stable_event)
      OR EXISTS (SELECT 1 FROM catlas_proof_captures WHERE event_id = alias_id AND event_id <> stable_event) THEN
      RAISE EXCEPTION 'catlas_alias_conflict';
    END IF;
    INSERT INTO catlas_proof_aliases(alias,event_id) VALUES(alias_id,stable_event) ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE catlas_proof_artifact_lifecycle SET writer_settled=true WHERE writer_owner=request_owner AND sha256 IN (capture->'artifacts'->'detail'->>'sha256',capture->'artifacts'->'grid'->>'sha256');
  SELECT event_id INTO requested_event FROM catlas_proof_attempts WHERE owner = request_owner AND state = 'pending';
  IF requested_event IS NOT NULL THEN
    PERFORM catlas_proof_associate(request_owner, requested_event, stable_event);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_orphan_candidates(request_owner uuid, requested_limit integer)
RETURNS TABLE(sha256 text, bytes bigint) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner = request_owner AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  RETURN QUERY SELECT a.sha256, a.bytes
    FROM catlas_proof_artifacts a JOIN catlas_proof_artifact_reconciliation r ON r.sha256 = a.sha256
    WHERE NOT EXISTS (SELECT 1 FROM catlas_proof_capture_versions c WHERE c.detail_sha256 = a.sha256 OR c.grid_sha256 = a.sha256)
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
      AND NOT EXISTS (SELECT 1 FROM catlas_proof_capture_versions c WHERE c.detail_sha256 = r.sha256 OR c.grid_sha256 = r.sha256)
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
        SELECT 1 FROM catlas_proof_capture_versions c WHERE c.detail_sha256 = a.sha256 OR c.grid_sha256 = a.sha256
      )), 0)::bigint AS referenced
    FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_lifecycle l USING(sha256) WHERE coalesce(l.availability,'present')<>'deleted'
  )
  SELECT pg_database_size(current_database()), amounts.reserved, amounts.referenced,
    amounts.reserved - amounts.referenced, b.bytes + catlas_proof_recovery_bytes(),
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
  SELECT coalesce(sum(a.bytes),0) INTO used FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_lifecycle l USING(sha256) WHERE coalesce(l.availability,'present')<>'deleted';
  IF used + greatest(backup_reserve, (SELECT bytes FROM catlas_proof_backup_usage WHERE singleton) + catlas_proof_recovery_bytes()) >= object_limit THEN
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
  SELECT coalesce(sum(a.bytes),0) INTO used FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_lifecycle l USING(sha256) WHERE coalesce(l.availability,'present')<>'deleted';
  IF used + greatest(backup_reserve, incoming_bytes + catlas_proof_recovery_bytes()) > object_limit THEN RAISE EXCEPTION 'catlas_object_capacity'; END IF;
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

-- Private operator cleanup snapshots are audit records, never routine logs.
CREATE TABLE IF NOT EXISTS catlas_proof_cleanup_plans (
  plan_id uuid PRIMARY KEY,
  confirmation text NOT NULL CHECK (confirmation ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '15 minutes',
  state text NOT NULL DEFAULT 'preview' CHECK(state IN ('preview','confirmed','completed')),
  artifacts jsonb NOT NULL,
  logs jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION catlas_proof_cleanup_view(requested_plan uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('planId',plan_id,'confirmation',confirmation,'createdAt',created_at,'expiresAt',expires_at,'state',state,'artifacts',artifacts,'logs',logs)
  FROM catlas_proof_cleanup_plans WHERE plan_id = requested_plan
$$;
CREATE OR REPLACE FUNCTION catlas_proof_cleanup_preview(request_owner uuid, requested_plan uuid, token text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE artifacts jsonb; logs jsonb;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO artifacts FROM (
    SELECT jsonb_build_object('sha256',a.sha256,'bytes',a.bytes,'objectKey',coalesce(l.storage_key,'sha256/'||a.sha256),'state','pending') item
    FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_lifecycle l USING(sha256)
    WHERE coalesce(l.availability,'present')='present' AND NOT coalesce(l.retained,false) AND coalesce(l.writer_settled,true) AND NOT coalesce(l.uncertain_writes,false) AND NOT EXISTS(SELECT 1 FROM catlas_proof_recovery_points p,jsonb_array_elements(p.document->'artifacts') a WHERE p.state='building' AND a->>'sha256'=l.sha256)
      AND EXISTS(SELECT 1 FROM catlas_proof_capture_versions c WHERE c.detail_sha256=a.sha256 OR c.grid_sha256=a.sha256)
      AND NOT EXISTS(SELECT 1 FROM catlas_proof_capture_versions c WHERE (c.detail_sha256=a.sha256 OR c.grid_sha256=a.sha256) AND c.captured_at>=clock_timestamp()-interval '90 days')
    ORDER BY a.sha256 LIMIT 16
  ) eligible;
  SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',event_id)),'[]'::jsonb) INTO logs FROM (
    SELECT event_id FROM catlas_proof_attempts WHERE state <> 'pending' AND finished_at<clock_timestamp()-interval '30 days' ORDER BY finished_at,event_id LIMIT 16
  ) eligible;
  INSERT INTO catlas_proof_cleanup_plans(plan_id,confirmation,artifacts,logs) VALUES(requested_plan,token,artifacts,logs);
  RETURN catlas_proof_cleanup_view(requested_plan);
END $$;

CREATE OR REPLACE FUNCTION catlas_proof_cleanup_confirm(request_owner uuid, requested_plan uuid, token text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE plan catlas_proof_cleanup_plans; item jsonb; deleted_logs jsonb := '[]'::jsonb; count_removed integer;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  SELECT * INTO plan FROM catlas_proof_cleanup_plans WHERE plan_id=requested_plan FOR UPDATE;
  IF NOT FOUND OR plan.confirmation<>token OR (plan.state='preview' AND plan.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'catlas_cleanup_invalid'; END IF;
  IF plan.state<>'preview' THEN RETURN catlas_proof_cleanup_view(requested_plan); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(plan.logs) LOOP
    DELETE FROM catlas_proof_attempts WHERE event_id=item->>'eventId' AND state<>'pending' AND finished_at<plan.created_at-interval '30 days';
    GET DIAGNOSTICS count_removed=ROW_COUNT;
    deleted_logs:=deleted_logs||jsonb_build_array(item||jsonb_build_object('state',CASE WHEN count_removed>0 THEN 'deleted' ELSE 'skipped' END));
  END LOOP;
  UPDATE catlas_proof_cleanup_plans SET state=CASE WHEN jsonb_array_length(artifacts)=0 THEN 'completed' ELSE 'confirmed' END,logs=deleted_logs WHERE plan_id=requested_plan;
  RETURN catlas_proof_cleanup_view(requested_plan);
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_cleanup_claim(request_owner uuid, requested_plan uuid, artifact_hash text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE plan catlas_proof_cleanup_plans; target jsonb; lifecycle catlas_proof_artifact_lifecycle; eligible boolean;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  SELECT * INTO plan FROM catlas_proof_cleanup_plans WHERE plan_id=requested_plan AND state='confirmed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_cleanup_invalid'; END IF;
  SELECT value INTO target FROM jsonb_array_elements(plan.artifacts) WHERE value->>'sha256'=artifact_hash;
  IF target IS NULL OR target->>'state' IN ('deleted','skipped') THEN RETURN false; END IF;
  SELECT * INTO lifecycle FROM catlas_proof_artifact_lifecycle WHERE sha256=artifact_hash FOR UPDATE;
  IF target->>'state'='deleting' AND lifecycle.availability='deleting' AND lifecycle.storage_key=target->>'objectKey' THEN RETURN true; END IF;
  eligible:=target->>'state'='pending' AND coalesce(lifecycle.storage_key,'sha256/'||artifact_hash)=target->>'objectKey' AND coalesce(lifecycle.availability,'present')='present' AND NOT coalesce(lifecycle.retained,false) AND coalesce(lifecycle.writer_settled,true) AND NOT coalesce(lifecycle.uncertain_writes,false) AND NOT EXISTS(SELECT 1 FROM catlas_proof_recovery_points p,jsonb_array_elements(p.document->'artifacts') a WHERE p.state='building' AND a->>'sha256'=artifact_hash)
    AND EXISTS(SELECT 1 FROM catlas_proof_capture_versions c WHERE c.detail_sha256=artifact_hash OR c.grid_sha256=artifact_hash)
    AND NOT EXISTS(SELECT 1 FROM catlas_proof_capture_versions c WHERE (c.detail_sha256=artifact_hash OR c.grid_sha256=artifact_hash) AND c.captured_at>=clock_timestamp()-interval '90 days');
  IF eligible THEN
    INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key,availability) VALUES(artifact_hash,target->>'objectKey','deleting') ON CONFLICT(sha256) DO UPDATE SET availability='deleting';
  END IF;
  UPDATE catlas_proof_cleanup_plans SET artifacts=(SELECT jsonb_agg(CASE WHEN value->>'sha256'=artifact_hash THEN value||jsonb_build_object('state',CASE WHEN eligible THEN 'deleting' ELSE 'skipped' END) ELSE value END) FROM jsonb_array_elements(artifacts)) WHERE plan_id=requested_plan;
  IF NOT eligible AND NOT EXISTS(SELECT 1 FROM catlas_proof_cleanup_plans p, jsonb_array_elements(p.artifacts) i WHERE p.plan_id=requested_plan AND i->>'state' IN ('pending','deleting')) THEN UPDATE catlas_proof_cleanup_plans SET state='completed' WHERE plan_id=requested_plan; END IF;
  RETURN eligible;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_cleanup_complete(request_owner uuid, requested_plan uuid, artifact_hash text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM catlas_proof_cleanup_plans p,jsonb_array_elements(p.artifacts) i WHERE p.plan_id=requested_plan AND p.state='confirmed' AND i->>'sha256'=artifact_hash AND i->>'state'='deleting' AND EXISTS(SELECT 1 FROM catlas_proof_artifact_lifecycle l WHERE l.sha256=artifact_hash AND l.availability='deleting' AND l.storage_key=i->>'objectKey')) THEN RAISE EXCEPTION 'catlas_cleanup_invalid'; END IF;
  UPDATE catlas_proof_artifact_lifecycle SET availability='deleted' WHERE sha256=artifact_hash AND availability='deleting';
  UPDATE catlas_proof_cleanup_plans SET artifacts=(SELECT jsonb_agg(CASE WHEN value->>'sha256'=artifact_hash THEN value||jsonb_build_object('state','deleted') ELSE value END) FROM jsonb_array_elements(artifacts)) WHERE plan_id=requested_plan;
  IF NOT EXISTS(SELECT 1 FROM catlas_proof_cleanup_plans p,jsonb_array_elements(p.artifacts) i WHERE p.plan_id=requested_plan AND i->>'state' IN ('pending','deleting')) THEN UPDATE catlas_proof_cleanup_plans SET state='completed' WHERE plan_id=requested_plan; END IF;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_cleanup_retention(request_owner uuid, artifact_hash text, retain boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE singleton AND owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF EXISTS(SELECT 1 FROM catlas_proof_artifact_lifecycle WHERE sha256=artifact_hash AND availability<>'present') THEN RAISE EXCEPTION 'catlas_cleanup_conflict'; END IF;
  INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key,retained) SELECT sha256,'sha256/'||sha256,retain FROM catlas_proof_artifacts WHERE sha256=artifact_hash ON CONFLICT(sha256) DO UPDATE SET retained=EXCLUDED.retained;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_cleanup_invalid'; END IF;
END $$;

-- Rolling upgrade: unknown/interrupted legacy reservation owners never authorize reclamation.
INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key,writer_owner,writer_settled,uncertain_writes)
  SELECT a.sha256,'sha256/'||a.sha256,r.last_owner, r.last_owner IS NOT NULL AND coalesce(t.state,'unknown')='completed', r.last_owner IS NULL OR coalesce(t.state,'unknown')<>'completed'
  FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_reconciliation r USING(sha256) LEFT JOIN catlas_proof_attempts t ON t.owner=r.last_owner
  ON CONFLICT(sha256) DO UPDATE SET writer_owner=EXCLUDED.writer_owner,writer_settled=EXCLUDED.writer_settled,uncertain_writes=catlas_proof_artifact_lifecycle.uncertain_writes OR EXCLUDED.uncertain_writes
  WHERE catlas_proof_artifact_lifecycle.writer_owner IS NULL;

CREATE OR REPLACE FUNCTION catlas_proof_recovery_snapshot(request_owner uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF EXISTS(SELECT 1 FROM catlas_proof_restore_jobs WHERE document->>'state'='restoring') THEN RAISE EXCEPTION 'catlas_recovery_busy'; END IF;
  SELECT jsonb_build_object(
   'artifacts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY sha256),'[]') FROM catlas_proof_artifacts t),
   'lifecycle',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY sha256),'[]') FROM catlas_proof_artifact_lifecycle t),
   'captures',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY event_id),'[]') FROM catlas_proof_captures t),
   'versions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY event_id,captured_at),'[]') FROM catlas_proof_capture_versions t),
   'aliases',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY alias),'[]') FROM catlas_proof_aliases t),
   'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY event_id),'[]') FROM catlas_proof_attempts t),
   'reconciliation',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY sha256),'[]') FROM catlas_proof_artifact_reconciliation t),
   'cleanupPlans',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY plan_id),'[]') FROM catlas_proof_cleanup_plans t),
   'dailyUsage',(SELECT jsonb_agg(to_jsonb(t)) FROM catlas_proof_daily_usage t),
   'dailyMaintenance',(SELECT jsonb_agg(to_jsonb(t)) FROM catlas_proof_daily_maintenance t),
   'backupUsage',(SELECT jsonb_agg(to_jsonb(t)) FROM catlas_proof_backup_usage t)
  ) INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_recovery_start(request_owner uuid, job jsonb, restoring boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE current_job jsonb;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF restoring THEN
    SELECT document INTO current_job FROM catlas_proof_restore_jobs WHERE document->>'state'='restoring' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'catlas_recovery_busy'; END IF;
    IF EXISTS(SELECT 1 FROM catlas_proof_artifact_lifecycle) OR EXISTS(SELECT 1 FROM catlas_proof_recovery_points) OR EXISTS(SELECT 1 FROM catlas_proof_recovery_objects) OR EXISTS(SELECT 1 FROM catlas_proof_restore_jobs) OR EXISTS(SELECT 1 FROM catlas_proof_backup_usage WHERE bytes<>0) OR EXISTS(SELECT 1 FROM catlas_proof_artifacts) OR EXISTS(SELECT 1 FROM catlas_proof_captures) OR EXISTS(SELECT 1 FROM catlas_proof_capture_versions) OR EXISTS(SELECT 1 FROM catlas_proof_cleanup_plans) OR EXISTS(SELECT 1 FROM catlas_proof_attempts) THEN RAISE EXCEPTION 'catlas_restore_not_empty'; END IF;
    INSERT INTO catlas_proof_restore_jobs VALUES((job->>'id')::uuid,job);
  ELSE
    SELECT document INTO current_job FROM catlas_proof_recovery_points WHERE state='building' LIMIT 1;
    IF FOUND THEN RETURN current_job; END IF;
    INSERT INTO catlas_proof_recovery_points VALUES((job->>'id')::uuid,job->>'state',job);
  END IF;
  RETURN job;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_recovery_save(request_owner uuid, job jsonb, restoring boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF restoring THEN
    UPDATE catlas_proof_artifact_lifecycle l SET storage_key=a->>'sourceKey',writer_settled=true FROM jsonb_array_elements(job->'artifacts') a WHERE l.sha256=a->>'sha256' AND (a->>'restored')::boolean;
    UPDATE catlas_proof_restore_jobs SET document=job WHERE id=(job->>'id')::uuid;
  ELSE UPDATE catlas_proof_recovery_points SET document=job,state=job->>'state' WHERE id=(job->>'id')::uuid; END IF;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_recovery_reserve(request_owner uuid, item jsonb, object_limit bigint, backup_reserve bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE used bigint; additional bigint;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  SELECT coalesce(sum(a.bytes),0) INTO used FROM catlas_proof_artifacts a LEFT JOIN catlas_proof_artifact_lifecycle l USING(sha256) WHERE coalesce(l.availability,'present')<>'deleted';
  SELECT CASE WHEN EXISTS(SELECT 1 FROM catlas_proof_recovery_objects WHERE key=item->>'key') THEN 0 ELSE (item->>'bytes')::bigint END INTO additional;
  IF used+greatest(backup_reserve,(SELECT bytes FROM catlas_proof_backup_usage WHERE singleton)+catlas_proof_recovery_bytes()+additional)>object_limit THEN RAISE EXCEPTION 'catlas_object_capacity'; END IF;
  IF EXISTS(SELECT 1 FROM catlas_proof_recovery_objects WHERE key=item->>'key' AND (state IN ('deleting','deleted') OR sha256<>item->>'sha256' OR bytes<>(item->>'bytes')::bigint)) THEN RAISE EXCEPTION 'catlas_artifact_conflict'; END IF;
  INSERT INTO catlas_proof_recovery_objects VALUES(item->>'key',item->>'sha256',(item->>'bytes')::bigint,'pending',item->>'kind') ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_recovery_object_state(request_owner uuid, object_key text, incoming_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  UPDATE catlas_proof_recovery_objects SET state=incoming_state WHERE key=object_key;
END $$;
CREATE OR REPLACE FUNCTION catlas_proof_recovery_rotate(request_owner uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE candidates jsonb;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  UPDATE catlas_proof_recovery_points SET state='expired',document=jsonb_set(document,'{state}','"expired"') WHERE state='complete' AND (document->>'createdAt')::timestamptz<clock_timestamp()-interval '30 days';
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO candidates FROM (SELECT o.* FROM catlas_proof_recovery_objects o WHERE o.state IN ('verified','deleting')
    AND NOT EXISTS(SELECT 1 FROM catlas_proof_recovery_points p WHERE p.state IN ('building','complete') AND
      (p.document->>'manifestKey'=o.key OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.document->'artifacts') a WHERE (a->>'backupKey'=o.key OR (p.state='building' AND a->>'backupKey' IS NULL AND a->>'sha256'=o.sha256 AND o.kind='content')))))
    AND NOT EXISTS(SELECT 1 FROM catlas_proof_restore_jobs j WHERE j.document->>'state'='restoring' AND (j.document->>'manifestKey'=o.key OR EXISTS(SELECT 1 FROM jsonb_array_elements(j.document->'artifacts') a WHERE a->>'backupKey'=o.key)))
    ORDER BY o.key LIMIT 4) r;
  UPDATE catlas_proof_recovery_objects SET state='deleting' WHERE key IN (SELECT value->>'key' FROM jsonb_array_elements(candidates));
  RETURN candidates;
END $$;

CREATE OR REPLACE FUNCTION catlas_proof_recovery_publish(request_owner uuid, job jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb := job->'snapshot'; item jsonb;
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM catlas_proof_restore_jobs WHERE id=(job->>'id')::uuid AND document->>'state'='restoring') OR EXISTS(SELECT 1 FROM catlas_proof_captures) THEN RAISE EXCEPTION 'catlas_restore_not_empty'; END IF;
  INSERT INTO catlas_proof_artifacts SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_artifacts,snapshot->'artifacts') ON CONFLICT DO NOTHING;
  INSERT INTO catlas_proof_artifact_lifecycle SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_artifact_lifecycle,snapshot->'lifecycle') ON CONFLICT DO NOTHING;
  FOR item IN SELECT value FROM jsonb_array_elements(job->'artifacts') LOOP
    IF NOT coalesce((item->>'restored')::boolean,false) THEN RAISE EXCEPTION 'catlas_restore_not_empty'; END IF;
    INSERT INTO catlas_proof_artifact_lifecycle(sha256,storage_key,availability,writer_settled)
      VALUES(item->>'sha256',item->>'sourceKey','present',true)
      ON CONFLICT(sha256) DO UPDATE SET storage_key=EXCLUDED.storage_key,availability='present',writer_owner=NULL,writer_settled=true,uncertain_writes=false,retained=coalesce((SELECT (l->>'retained')::boolean FROM jsonb_array_elements(snapshot->'lifecycle') l WHERE l->>'sha256'=item->>'sha256'),false);
  END LOOP;
  INSERT INTO catlas_proof_captures SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_captures,snapshot->'captures');
  INSERT INTO catlas_proof_capture_versions SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_capture_versions,snapshot->'versions');
  INSERT INTO catlas_proof_aliases SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_aliases,snapshot->'aliases');
  INSERT INTO catlas_proof_attempts SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_attempts,snapshot->'attempts');
  UPDATE catlas_proof_attempts SET state='interrupted',finished_at=clock_timestamp() WHERE state='pending';
  INSERT INTO catlas_proof_artifact_reconciliation SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_artifact_reconciliation,snapshot->'reconciliation') ON CONFLICT(sha256) DO UPDATE SET last_owner=EXCLUDED.last_owner,state=EXCLUDED.state,reconciled_at=EXCLUDED.reconciled_at;
  INSERT INTO catlas_proof_cleanup_plans SELECT * FROM jsonb_populate_recordset(NULL::catlas_proof_cleanup_plans,snapshot->'cleanupPlans');
  -- Preserve the audit; old capabilities cannot authorize deletion in the recovered archive.
  UPDATE catlas_proof_cleanup_plans SET state='completed',expires_at=clock_timestamp(),artifacts=(SELECT coalesce(jsonb_agg(CASE WHEN a->>'state' IN ('pending','deleting') THEN a||jsonb_build_object('state','skipped') ELSE a END),'[]') FROM jsonb_array_elements(artifacts) a);
  UPDATE catlas_proof_daily_usage SET capture_attempts=greatest(capture_attempts,coalesce((snapshot->'dailyUsage'->0->>'capture_attempts')::bigint,0)) WHERE usage_date=(snapshot->'dailyUsage'->0->>'usage_date')::date;
  UPDATE catlas_proof_daily_maintenance SET requests=greatest(requests,coalesce((snapshot->'dailyMaintenance'->0->>'requests')::bigint,0)) WHERE usage_date=(snapshot->'dailyMaintenance'->0->>'usage_date')::date;
  UPDATE catlas_proof_backup_usage SET bytes=greatest(bytes,coalesce((snapshot->'backupUsage'->0->>'bytes')::bigint,0));
  UPDATE catlas_proof_restore_jobs SET document=job||jsonb_build_object('state','complete','completedAt',clock_timestamp()) WHERE id=(job->>'id')::uuid;
END $$;

CREATE OR REPLACE FUNCTION catlas_proof_recovery_gate(request_owner uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM catlas_proof_capture_lease WHERE owner=request_owner AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catlas_lease_lost'; END IF;
  IF EXISTS(SELECT 1 FROM catlas_proof_restore_jobs WHERE document->>'state'='restoring') THEN RAISE EXCEPTION 'catlas_recovery_busy'; END IF;
END $$;
