exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE factory.intake_heads (
      organization_id text NOT NULL, project_id text NOT NULL, id text NOT NULL,
      owner_id text NOT NULL, version integer NOT NULL CHECK (version > 0),
      PRIMARY KEY (organization_id, project_id, id),
      UNIQUE (organization_id, project_id, id, owner_id),
      FOREIGN KEY (organization_id, project_id) REFERENCES factory.projects
    );
    CREATE TABLE factory.intake_revisions (
      organization_id text NOT NULL, project_id text NOT NULL, id text NOT NULL,
      owner_id text NOT NULL, version integer NOT NULL CHECK (version > 0),
      actor name NOT NULL DEFAULT session_user,
      objective text NOT NULL CHECK (length(btrim(objective)) BETWEEN 1 AND 4000),
      context text NOT NULL CHECK (length(btrim(context)) BETWEEN 1 AND 4000),
      source_kind text NOT NULL CHECK (source_kind IN ('file','cli')),
      original bytea NOT NULL CHECK (octet_length(original) BETWEEN 1 AND 65536),
      digest text GENERATED ALWAYS AS (encode(sha256(original), 'hex')) STORED,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (organization_id, project_id, id, version),
      FOREIGN KEY (organization_id, project_id, id, owner_id) REFERENCES factory.intake_heads (organization_id, project_id, id, owner_id)
    );
    ALTER TABLE factory.intake_heads ADD CONSTRAINT intake_current_revision
      FOREIGN KEY (organization_id, project_id, id, version) REFERENCES factory.intake_revisions
      DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE factory.intake_receipts (
      organization_id text NOT NULL, project_id text NOT NULL, owner_id text NOT NULL,
      actor name NOT NULL DEFAULT session_user, operation text NOT NULL CHECK (operation IN ('create','revise')),
      key text NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
      digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
      id text NOT NULL, version integer NOT NULL,
      PRIMARY KEY (organization_id, project_id, actor, operation, key),
      FOREIGN KEY (organization_id, project_id, id, owner_id) REFERENCES factory.intake_heads (organization_id, project_id, id, owner_id),
      FOREIGN KEY (organization_id, project_id, id, version) REFERENCES factory.intake_revisions
    );
    CREATE FUNCTION factory.guard_intake_head() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.version <> 1 THEN RAISE EXCEPTION 'Initial intake version must be one'; END IF;
      ELSIF (NEW.organization_id,NEW.project_id,NEW.id,NEW.owner_id) IS DISTINCT FROM
            (OLD.organization_id,OLD.project_id,OLD.id,OLD.owner_id) OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'Intake identity is immutable and versions must be sequential';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER intake_head_guard BEFORE INSERT OR UPDATE ON factory.intake_heads
      FOR EACH ROW EXECUTE FUNCTION factory.guard_intake_head();
    CREATE FUNCTION factory.guard_intake_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT FROM factory.intake_heads h WHERE
        (h.organization_id,h.project_id,h.id,h.owner_id,h.version) =
        (NEW.organization_id,NEW.project_id,NEW.id,NEW.owner_id,NEW.version)) THEN
        RAISE EXCEPTION 'Revision must match the current intake head';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER intake_revision_guard BEFORE INSERT ON factory.intake_revisions
      FOR EACH ROW EXECUTE FUNCTION factory.guard_intake_revision();
  `);
  for (const table of ['intake_heads', 'intake_revisions', 'intake_receipts']) {
    const membership = `EXISTS (SELECT FROM factory.memberships m WHERE m.database_role=session_user
      AND m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id)`;
    const writer = `EXISTS (SELECT FROM factory.memberships m WHERE m.database_role=session_user
      AND m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id
      AND m.owner_id=${table}.owner_id AND m.can_write)`;
    const actor = table === 'intake_heads' ? '' : ' AND actor=session_user';
    pgm.sql(`
      ALTER TABLE factory.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE factory.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY intake_read ON factory.${table} FOR SELECT USING (${membership}${table === 'intake_receipts' ? ' AND actor=session_user' : ''});
      CREATE POLICY intake_insert ON factory.${table} FOR INSERT WITH CHECK (${writer}${actor});
    `);
    if (table === 'intake_heads') pgm.sql(`CREATE POLICY intake_update ON factory.intake_heads FOR UPDATE USING (${writer}) WITH CHECK (${writer});`);
  }
};
exports.down = () => { throw new Error('Destructive rollback is not supported. Restore an authorized backup instead.'); };
