import { Client } from 'pg';
const client = new Client({ connectionString: process.env.FACTORY_MIGRATION_URL });
if (!process.env.FACTORY_MIGRATION_URL) throw new Error('FACTORY_MIGRATION_URL is required. Use only the disposable local database.');
await client.connect();
try {
  if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'agentic_factory_local') throw new Error('Synthetic setup is restricted to agentic_factory_local.');
  for (const role of ['af_app', 'af_other', 'af_reader', 'af_peer']) {
    // Role names are fixed project-authored identifiers, never input.
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-local-runtime-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF; END $$`);
    await client.query(`GRANT USAGE ON SCHEMA factory TO ${role}`);
    if (role === 'af_peer') {
      await client.query('REVOKE ALL ON factory.projects, factory.runs, factory.revisions, factory.events, factory.receipts FROM af_peer');
      await client.query('GRANT SELECT ON factory.memberships, factory.intake_heads, factory.intake_revisions, factory.intake_receipts TO af_peer');
    } else {
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA factory TO ${role}`);
      await client.query(`GRANT INSERT ON factory.runs, factory.revisions, factory.events, factory.receipts TO ${role}`);
      await client.query(`GRANT UPDATE ON factory.runs TO ${role}`);
    }
    await client.query(`GRANT INSERT ON factory.intake_heads, factory.intake_revisions, factory.intake_receipts TO ${role}`);
    await client.query(`GRANT UPDATE (version) ON factory.intake_heads TO ${role}`);
  }
  await client.query(`INSERT INTO factory.projects VALUES ('synthetic-org-a','synthetic-software-project'),('synthetic-org-a','synthetic-ml-project'),('synthetic-org-b','synthetic-software-project') ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO factory.memberships VALUES
    ('af_app','synthetic-org-a','synthetic-software-project','synthetic-owner',true,true),
    ('af_peer','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false),
    ('af_app','synthetic-org-a','synthetic-ml-project','synthetic-owner',true,true),
    ('af_other','synthetic-org-b','synthetic-software-project','synthetic-owner',true,true),
    ('af_reader','synthetic-org-a','synthetic-software-project','synthetic-owner',false,false)
    ON CONFLICT DO NOTHING`);
  console.log('Synthetic local roles and memberships installed. No runtime role has DDL, superuser, or BYPASSRLS privileges.');
} finally { await client.end(); }
