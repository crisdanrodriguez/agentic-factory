// Synthetic fixtures only. Real installation roles and identities require local operator provisioning.
import { Client } from 'pg';
if (!process.env.FACTORY_MIGRATION_URL) throw new Error('FACTORY_MIGRATION_URL is required.');
const client = new Client({ connectionString: process.env.FACTORY_MIGRATION_URL });
await client.connect();
try {
  if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'agentic_factory_local') throw new Error('Synthetic setup requires agentic_factory_local.');
  await client.query('BEGIN');
  for (const role of ['af_slack_bot', 'af_slack_admin']) {
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-local-runtime-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF; END $$`);
    await client.query(`GRANT USAGE ON SCHEMA factory TO ${role}`);
    await client.query(`GRANT SELECT ON factory.memberships,factory.slack_installations,factory.slack_pairings TO ${role}`);
    await client.query(`INSERT INTO factory.memberships VALUES ('${role}','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false) ON CONFLICT DO NOTHING`);
  }
  await client.query(`GRANT UPDATE (generation,state,challenge_hash,expires_at,chat_id,claimed_at) ON factory.slack_pairings TO af_slack_admin;
    GRANT UPDATE (state,chat_id,claimed_at,rejected_count,command_times,tokens,token_time,next_send_at) ON factory.slack_pairings TO af_slack_bot;
    GRANT SELECT,UPDATE ON factory.slack_updates,factory.slack_outbox TO af_slack_bot;
    GRANT INSERT ON factory.slack_updates,factory.slack_outbox TO af_slack_bot;
    GRANT SELECT ON factory.intake_heads,factory.intake_revisions,factory.intake_receipts TO af_slack_bot;
    GRANT INSERT ON factory.intake_heads,factory.intake_revisions,factory.intake_receipts TO af_slack_bot;
    GRANT UPDATE (version) ON factory.intake_heads TO af_slack_bot;
    INSERT INTO factory.slack_installations VALUES
      ('synthetic-slack','TTEST','ATEST','BTEST','UBOT','af_slack_bot','af_slack_admin','UHUMAN','synthetic-org-a','synthetic-software-project','synthetic-owner') ON CONFLICT DO NOTHING;
    INSERT INTO factory.slack_pairings (installation_id) VALUES ('synthetic-slack') ON CONFLICT DO NOTHING;
`);
  await client.query('COMMIT');
  console.log('Synthetic Slack identities provisioned. No token, provider, execution, or live API access configured.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
