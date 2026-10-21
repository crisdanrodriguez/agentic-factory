exports.up = (pgm) => {
  pgm.sql(`
    CREATE SCHEMA factory;
    REVOKE ALL ON SCHEMA factory FROM PUBLIC;
    CREATE TABLE factory.projects (
      organization_id text NOT NULL, project_id text NOT NULL,
      PRIMARY KEY (organization_id, project_id)
    );
    CREATE TABLE factory.memberships (
      database_role name NOT NULL, organization_id text NOT NULL, project_id text NOT NULL,
      owner_id text NOT NULL, can_write boolean NOT NULL DEFAULT false, can_approve boolean NOT NULL DEFAULT false,
      PRIMARY KEY (database_role, organization_id, project_id),
      FOREIGN KEY (organization_id, project_id) REFERENCES factory.projects
    );
    ALTER TABLE factory.memberships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE factory.memberships FORCE ROW LEVEL SECURITY;
    CREATE POLICY self_membership ON factory.memberships FOR SELECT USING (database_role = session_user);
    CREATE TABLE factory.runs (
      organization_id text NOT NULL, project_id text NOT NULL, id text NOT NULL,
      version integer NOT NULL CHECK (version >= 0), state jsonb NOT NULL,
      PRIMARY KEY (organization_id, project_id, id),
      FOREIGN KEY (organization_id, project_id) REFERENCES factory.projects,
      CHECK (state->>'id' = id), CHECK (state->'config'->'workItem'->>'projectId' = project_id)
    );
    CREATE TABLE factory.revisions (
      organization_id text NOT NULL, project_id text NOT NULL, run_id text NOT NULL,
      revision text NOT NULL, configuration jsonb NOT NULL,
      PRIMARY KEY (organization_id, project_id, run_id, revision),
      FOREIGN KEY (organization_id, project_id, run_id) REFERENCES factory.runs
    );
    CREATE TABLE factory.events (
      organization_id text NOT NULL, project_id text NOT NULL, run_id text NOT NULL,
      version integer NOT NULL, actor name NOT NULL, command jsonb NOT NULL,
      PRIMARY KEY (organization_id, project_id, run_id, version),
      FOREIGN KEY (organization_id, project_id, run_id) REFERENCES factory.runs
    );
    CREATE TABLE factory.receipts (
      organization_id text NOT NULL, project_id text NOT NULL, run_id text NOT NULL,
      event_id text NOT NULL, digest text NOT NULL, result jsonb NOT NULL,
      PRIMARY KEY (organization_id, project_id, run_id, event_id),
      FOREIGN KEY (organization_id, project_id, run_id) REFERENCES factory.runs
    );
    ALTER TABLE factory.projects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE factory.projects FORCE ROW LEVEL SECURITY;
    CREATE POLICY project_read ON factory.projects FOR SELECT USING (EXISTS (
      SELECT FROM factory.memberships m WHERE m.organization_id=projects.organization_id AND m.project_id=projects.project_id AND m.database_role=session_user
    ));
  `);
  for (const table of ['runs', 'revisions', 'events', 'receipts']) {
    pgm.sql(`
      ALTER TABLE factory.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE factory.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY scoped_read ON factory.${table} FOR SELECT USING (EXISTS (
        SELECT FROM factory.memberships m WHERE m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id AND m.database_role=session_user
      ));
      CREATE POLICY scoped_insert ON factory.${table} FOR INSERT WITH CHECK (EXISTS (
        SELECT FROM factory.memberships m WHERE m.organization_id=${table}.organization_id AND m.project_id=${table}.project_id AND m.database_role=session_user AND m.can_write
      ));
    `);
  }
  pgm.sql(`CREATE POLICY scoped_update ON factory.runs FOR UPDATE USING (EXISTS (
    SELECT FROM factory.memberships m WHERE m.organization_id=runs.organization_id AND m.project_id=runs.project_id AND m.database_role=session_user AND m.can_write
  )) WITH CHECK (EXISTS (
    SELECT FROM factory.memberships m WHERE m.organization_id=runs.organization_id AND m.project_id=runs.project_id AND m.database_role=session_user AND m.can_write
  ));`);
};
exports.down = () => { throw new Error('Destructive rollback is not supported. Restore an authorized backup instead.'); };
