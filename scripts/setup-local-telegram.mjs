// Synthetic fixtures only. Real installation roles and identities require local operator provisioning.
import { Client } from 'pg';
if (!process.env.FACTORY_MIGRATION_URL) throw new Error('FACTORY_MIGRATION_URL is required.');
const client = new Client({ connectionString: process.env.FACTORY_MIGRATION_URL });
await client.connect();
try {
  if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'agentic_factory_local') throw new Error('Synthetic setup requires agentic_factory_local.');
  await client.query('BEGIN');
  for (const role of ['af_telegram_bot', 'af_telegram_admin']) {
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-local-runtime-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF; END $$`);
    await client.query(`GRANT USAGE ON SCHEMA factory TO ${role}`);
    await client.query(`GRANT SELECT ON factory.memberships,factory.telegram_installations,factory.telegram_pairings TO ${role}`);
    await client.query(`INSERT INTO factory.memberships VALUES ('${role}','synthetic-org-a','synthetic-software-project','synthetic-owner',true,false) ON CONFLICT DO NOTHING`);
  }
  await client.query(`GRANT UPDATE (generation,state,challenge_hash,expires_at,chat_id,claimed_at) ON factory.telegram_pairings TO af_telegram_admin;
    GRANT UPDATE (state,chat_id,claimed_at) ON factory.telegram_pairings TO af_telegram_bot;
    GRANT SELECT,UPDATE ON factory.telegram_polling,factory.telegram_updates,factory.telegram_outbox TO af_telegram_bot;
    GRANT INSERT ON factory.telegram_updates,factory.telegram_outbox TO af_telegram_bot;
    GRANT SELECT ON factory.intake_heads,factory.intake_revisions,factory.intake_receipts TO af_telegram_bot;
    GRANT INSERT ON factory.intake_heads,factory.intake_revisions,factory.intake_receipts TO af_telegram_bot;
    GRANT UPDATE (version) ON factory.intake_heads TO af_telegram_bot;
    INSERT INTO factory.telegram_installations VALUES
      ('synthetic-telegram',900001,'af_telegram_bot','af_telegram_admin',900002,'synthetic-org-a','synthetic-software-project','synthetic-owner') ON CONFLICT DO NOTHING;
    INSERT INTO factory.telegram_pairings (installation_id) VALUES ('synthetic-telegram') ON CONFLICT DO NOTHING;
    INSERT INTO factory.telegram_polling (installation_id) VALUES ('synthetic-telegram') ON CONFLICT DO NOTHING;`);
  await client.query('COMMIT');
  console.log('Synthetic Telegram identities provisioned. No token, provider, execution, or live API access configured.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
