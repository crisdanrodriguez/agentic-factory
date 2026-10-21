import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
if (!process.env.FACTORY_MIGRATION_URL) throw new Error('FACTORY_MIGRATION_URL is required.');
const client = new Client({ connectionString: process.env.FACTORY_MIGRATION_URL });
const boss = new PgBoss({ connectionString: process.env.FACTORY_MIGRATION_URL, schema: 'factory_queue', supervise: false, schedule: false, registerInstance: false });
boss.on('error', () => { process.exitCode = 1; });
try {
  await client.connect();
  if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'agentic_factory_local') throw new Error('Synthetic queue setup is restricted to agentic_factory_local.');
  await boss.start();
  await boss.createQueue('workflow', { retryLimit: 2, retryDelay: 1, expireInSeconds: 30 });
  await client.query('GRANT USAGE ON SCHEMA factory_queue TO af_app');
  await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA factory_queue TO af_app');
  await client.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA factory_queue TO af_app');
  console.log('Queue schema migrated explicitly; runtime receives DML privileges only.');
} finally { await boss.stop(); await client.end(); }
