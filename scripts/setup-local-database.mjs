import { Client } from 'pg';
const client = new Client({ connectionString: process.env.FACTORY_MIGRATION_URL });
if (!process.env.FACTORY_MIGRATION_URL) throw new Error('FACTORY_MIGRATION_URL is required. Use only the disposable local database.');
await client.connect();
try {
  const expectedDatabase = process.env.FACTORY_SETUP_DATABASE ?? 'agentic_factory_local';
  if ((await client.query('SELECT current_database() AS name')).rows[0].name !== expectedDatabase) throw new Error(`Synthetic setup is restricted to ${expectedDatabase}.`);
  for (const role of ['af_app', 'af_other', 'af_reader', 'af_peer', 'af_github_intake', 'af_github_refiner']) {
    // Role names are fixed project-authored identifiers, never input.
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-local-runtime-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF; END $$`);
  }
  // Reconcile the two dedicated MVP-01B roles on every local setup run. A stale
  // grant must not survive merely because the role already existed.
  for (const role of ['af_github_intake', 'af_github_refiner']) {
    await client.query(`ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA factory FROM ${role}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA factory FROM ${role}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA factory FROM ${role}`);
    await client.query(`REVOKE CREATE ON SCHEMA factory FROM ${role}`);
  }
  await client.query('REVOKE af_app, af_other, af_reader, af_peer, af_github_refiner FROM af_github_intake');
  await client.query('REVOKE af_app, af_other, af_reader, af_peer, af_github_intake FROM af_github_refiner');
  const roleSafety = await client.query(`SELECT r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolinherit,
    pg_has_role(r.oid,'af_app'::regrole,'MEMBER') AS member_of_app,
    EXISTS (SELECT FROM pg_class c WHERE c.relowner=r.oid AND c.relnamespace='factory'::regnamespace)
      OR EXISTS (SELECT FROM pg_proc p WHERE p.proowner=r.oid AND p.pronamespace='factory'::regnamespace) AS owns_factory_objects
    FROM pg_roles r WHERE r.rolname IN ('af_github_intake','af_github_refiner')`);
  if (roleSafety.rowCount !== 2 || roleSafety.rows.some((role) => role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls || role.rolinherit || role.member_of_app || role.owns_factory_objects)) throw new Error('Dedicated GitHub database roles do not satisfy the least-privilege baseline.');
  for (const role of ['af_app', 'af_other', 'af_reader', 'af_peer', 'af_github_intake', 'af_github_refiner']) {
    await client.query(`GRANT USAGE ON SCHEMA factory TO ${role}`);
    if (role === 'af_peer') {
      await client.query('REVOKE ALL ON factory.projects, factory.runs, factory.revisions, factory.events, factory.receipts FROM af_peer');
      await client.query('REVOKE ALL ON factory.intake_heads, factory.intake_revisions, factory.intake_receipts FROM af_peer');
      await client.query('GRANT SELECT ON factory.memberships, factory.intake_heads, factory.intake_revisions, factory.intake_receipts TO af_peer');
      await client.query('GRANT INSERT ON factory.intake_heads, factory.intake_revisions, factory.intake_receipts TO af_peer');
      await client.query('GRANT UPDATE (version) ON factory.intake_heads TO af_peer');
    } else if (role === 'af_reader') {
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA factory TO ${role}`);
    } else if (role === 'af_github_intake') {
      await client.query('GRANT SELECT ON factory.memberships, factory.projects, factory.intake_heads, factory.intake_revisions, factory.intake_receipts, factory.github_origins, factory.refinement_intents TO af_github_intake');
      await client.query('GRANT INSERT ON factory.intake_heads, factory.intake_revisions, factory.intake_receipts, factory.github_origins, factory.refinement_intents TO af_github_intake');
      await client.query('GRANT UPDATE (version) ON factory.intake_heads TO af_github_intake');
      await client.query('GRANT UPDATE (status,cancellation_requested,lease_token,lease_expires_at,updated_at) ON factory.refinement_intents TO af_github_intake');
    } else if (role === 'af_github_refiner') {
      await client.query('GRANT SELECT ON factory.memberships, factory.projects, factory.intake_heads, factory.intake_revisions, factory.github_origins, factory.refinement_intents, factory.runs TO af_github_refiner');
      await client.query('GRANT UPDATE (status,attempt_count,next_attempt_at,lease_token,lease_expires_at,cancellation_requested,plan_run_id,last_error,updated_at) ON factory.refinement_intents TO af_github_refiner');
      await client.query('GRANT INSERT ON factory.runs, factory.revisions TO af_github_refiner');
    } else {
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA factory TO ${role}`);
      await client.query(`GRANT INSERT ON factory.runs, factory.revisions, factory.events, factory.receipts TO ${role}`);
      await client.query(`GRANT UPDATE ON factory.runs TO ${role}`);
    }
    if (role === 'af_reader') {
      await client.query(`GRANT SELECT ON factory.github_origins, factory.refinement_intents TO ${role}`);
    } else if (role === 'af_app' || role === 'af_other') {
      await client.query(`GRANT SELECT, INSERT ON factory.github_origins TO ${role}`);
      await client.query(`GRANT SELECT, INSERT ON factory.refinement_intents TO ${role}`);
      await client.query(`GRANT UPDATE (status,attempt_count,next_attempt_at,lease_token,lease_expires_at,cancellation_requested,plan_run_id,last_error,updated_at) ON factory.refinement_intents TO ${role}`);
    }
    if (!['af_reader','af_peer'].includes(role)) {
      if (!['af_github_intake','af_github_refiner'].includes(role)) {
        await client.query(`GRANT INSERT ON factory.intake_heads, factory.intake_revisions, factory.intake_receipts TO ${role}`);
        await client.query(`GRANT UPDATE (version) ON factory.intake_heads TO ${role}`);
      }
    }
  }
  await client.query(`INSERT INTO factory.projects VALUES ('synthetic-org-a','synthetic-software-project'),('synthetic-org-a','synthetic-ml-project'),('synthetic-org-b','synthetic-software-project') ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO factory.memberships VALUES
    ('af_app','synthetic-org-a','synthetic-software-project','synthetic-owner',true,true),
    ('af_peer','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false),
    ('af_app','synthetic-org-a','synthetic-ml-project','synthetic-owner',true,true),
    ('af_other','synthetic-org-b','synthetic-software-project','synthetic-owner',true,true),
    ('af_reader','synthetic-org-a','synthetic-software-project','synthetic-owner',false,false)
    ,('af_github_intake','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false)
    ,('af_github_refiner','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false)
    ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO factory.memberships VALUES
    ('af_github_intake','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false),
    ('af_github_refiner','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false)
    ON CONFLICT (database_role,organization_id,project_id) DO UPDATE
      SET owner_id=EXCLUDED.owner_id, can_write=true, can_approve=false`);
  console.log('Synthetic local roles and memberships installed. No runtime role has DDL, superuser, or BYPASSRLS privileges.');
} finally { await client.end(); }
