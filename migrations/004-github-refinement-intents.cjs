exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE factory.github_origins (
    organization_id text NOT NULL, project_id text NOT NULL, provider text NOT NULL,
    reference text NOT NULL, work_item_id text NOT NULL, owner_id text NOT NULL,
    PRIMARY KEY (organization_id, project_id, provider, reference),
    UNIQUE (organization_id, project_id, work_item_id),
    FOREIGN KEY (organization_id, project_id, work_item_id, owner_id)
      REFERENCES factory.intake_heads(organization_id, project_id, id, owner_id)
  )`);
  pgm.addConstraint({ schema: 'factory', name: 'github_origins' }, 'origin_bounds', { check: "length(provider) BETWEEN 1 AND 128 AND length(reference) BETWEEN 1 AND 512" });
  pgm.sql(`CREATE TABLE factory.refinement_intents (
    organization_id text NOT NULL, project_id text NOT NULL, work_item_id text NOT NULL,
    source_revision text NOT NULL, origin_provider text NOT NULL, origin_reference text NOT NULL,
    status text NOT NULL DEFAULT 'pending', attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_token text, lease_expires_at timestamptz, cancellation_requested boolean NOT NULL DEFAULT false,
    plan_run_id text, last_error text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, project_id, work_item_id, source_revision),
    FOREIGN KEY (organization_id, project_id, work_item_id) REFERENCES factory.intake_heads(organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id, origin_provider, origin_reference)
      REFERENCES factory.github_origins(organization_id, project_id, provider, reference)
  )`);
  pgm.addConstraint({ schema: 'factory', name: 'refinement_intents' }, 'status_check', { check: "status IN ('pending','running','succeeded','failed','cancelled','superseded')" });
  pgm.addConstraint({ schema: 'factory', name: 'refinement_intents' }, 'revision_check', { check: "source_revision ~ '^r[1-9][0-9]*$'" });
  pgm.addConstraint({ schema: 'factory', name: 'refinement_intents' }, 'origin_bounds', { check: "length(origin_provider) BETWEEN 1 AND 128 AND length(origin_reference) BETWEEN 1 AND 512" });
  pgm.addConstraint({ schema: 'factory', name: 'refinement_intents' }, 'attempts_check', { check: 'attempt_count BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 3' });
  pgm.addIndex({ schema: 'factory', name: 'refinement_intents' }, ['status', 'next_attempt_at'], { name: 'refinement_intents_due_idx' });
  pgm.sql("CREATE INDEX refinement_intents_expired_lease_idx ON factory.refinement_intents (organization_id, project_id, lease_expires_at) WHERE status='running' AND cancellation_requested=false");
  pgm.sql(`CREATE FUNCTION factory.guard_mvp01b_runtime_writes() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE approved boolean; owner_identity text; current_revision integer;
    BEGIN
      IF TG_TABLE_NAME='refinement_intents' AND session_user='af_github_intake' THEN
        IF NEW.status <> 'superseded' OR NEW.cancellation_requested IS DISTINCT FROM true
          OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
          RAISE EXCEPTION 'Intake may only supersede obsolete refinement intents';
        END IF;
      ELSIF TG_TABLE_NAME='runs' THEN
        SELECT can_approve, owner_id INTO approved, owner_identity FROM factory.memberships
          WHERE database_role=session_user AND organization_id=NEW.organization_id AND project_id=NEW.project_id;
        IF NOT COALESCE(approved,false) THEN
          SELECT version INTO current_revision FROM factory.intake_heads
            WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
              AND id=NEW.state->'config'->'workItem'->>'id' AND owner_id=owner_identity;
          IF NEW.version <> 0
            OR NEW.state->>'phase' IS DISTINCT FROM 'awaiting-approval'
            OR NEW.state->'approval'->>'status' IS DISTINCT FROM 'pending'
            OR NEW.state->'outcome'->>'execution' IS DISTINCT FROM 'pending'
            OR NEW.state->'outcome'->>'humanDecision' IS DISTINCT FROM 'pending'
            OR NEW.state->'job' IS DISTINCT FROM 'null'::jsonb
            OR current_revision IS NULL
            OR NEW.state->'config'->'workItem'->>'revision' IS DISTINCT FROM ('r' || current_revision::text)
            OR NEW.state->'config'->'workItem'->>'ownerId' IS DISTINCT FROM owner_identity
            OR NEW.state->'approval'->>'planRevision' IS DISTINCT FROM NEW.state->'config'->'plan'->>'revision'
            OR NEW.state->'approval'->>'policyRevision' IS DISTINCT FROM NEW.state->'config'->'plan'->>'policyRevision' THEN
            RAISE EXCEPTION 'A non-approver may only create a pending Run for the current WorkItem revision';
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    END $$`);
  pgm.sql(`CREATE TRIGGER refinement_intent_intake_guard BEFORE UPDATE ON factory.refinement_intents
    FOR EACH ROW EXECUTE FUNCTION factory.guard_mvp01b_runtime_writes()`);
  pgm.sql(`CREATE TRIGGER github_refiner_run_guard BEFORE INSERT ON factory.runs
    FOR EACH ROW EXECUTE FUNCTION factory.guard_mvp01b_runtime_writes()`);
  for (const table of ['github_origins', 'refinement_intents']) {
    const ownerCondition = table === 'github_origins' ? ` AND m.owner_id=${table}.owner_id` : '';
    pgm.sql(`
      ALTER TABLE factory.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE factory.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_read ON factory.${table} FOR SELECT USING (EXISTS (
        SELECT FROM factory.memberships m WHERE m.database_role=session_user
          AND m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id
      ));
      CREATE POLICY ${table}_write ON factory.${table} FOR INSERT WITH CHECK (EXISTS (
        SELECT FROM factory.memberships m WHERE m.database_role=session_user
          AND m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id AND m.can_write${ownerCondition}
      ));
      CREATE POLICY ${table}_update ON factory.${table} FOR UPDATE USING (EXISTS (
        SELECT FROM factory.memberships m WHERE m.database_role=session_user
          AND m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id AND m.can_write${ownerCondition}
      )) WITH CHECK (EXISTS (
        SELECT FROM factory.memberships m WHERE m.database_role=session_user
          AND m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id AND m.can_write${ownerCondition}
      ));
    `);
  }
};

exports.down = () => { throw new Error('Destructive rollback is not supported. Restore an authorized backup instead.'); };
