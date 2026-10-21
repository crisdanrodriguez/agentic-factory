import assert from 'node:assert/strict';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
import { runner } from 'node-pg-migrate';

// Public synthetic credentials for the loopback-only disposable Compose database.
const migrationUrl = 'postgres://af_migrator:synthetic-local-migration-only@127.0.0.1:55432/agentic_factory_local';
const applicationUrl = 'postgres://af_checkpoint_app:synthetic-checkpoint-only@127.0.0.1:55432/agentic_factory_local';
const admin = new Client({ connectionString: migrationUrl });
const app = new Client({ connectionString: applicationUrl });
const boss = new PgBoss({ connectionString: migrationUrl, schema: 'af_checkpoint_queue', supervise: false, schedule: false });
boss.on('error', () => { process.exitCode = 1; });
try {
  await admin.connect();
  console.log((await admin.query('SELECT version() AS version')).rows[0].version);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'af_checkpoint_app') THEN
      CREATE ROLE af_checkpoint_app LOGIN PASSWORD 'synthetic-checkpoint-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
  END $$`);
  await runner({ databaseUrl: migrationUrl, dir: 'tests/database/migrations', direction: 'up', migrationsTable: 'af_checkpoint_migrations', log: () => {} });
  await runner({ databaseUrl: migrationUrl, dir: 'tests/database/migrations', direction: 'up', migrationsTable: 'af_checkpoint_migrations', log: () => {} });
  console.log('PASS: node-pg-migrate applies and safely reruns the migration.');
  await boss.start();
  await boss.createQueue('compatibility');
  await admin.query('GRANT USAGE ON SCHEMA af_checkpoint_queue TO af_checkpoint_app');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA af_checkpoint_queue TO af_checkpoint_app');
  await admin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA af_checkpoint_queue TO af_checkpoint_app');
  await app.connect();
  const role = (await app.query('SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  const db = { executeSql: (text, values) => app.query(text, values) };
  const id = `synthetic-${Date.now()}`;
  await app.query('BEGIN');
  await app.query('INSERT INTO af_compatibility.records VALUES ($1,$2)', [id, 'synthetic-org-a']);
  const committedJob = await boss.send('compatibility', { id }, { db });
  await app.query('COMMIT');
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM af_compatibility.records WHERE id=$1', [id])).rows[0].count, 1);
  assert.ok(await boss.getJobById('compatibility', committedJob));
  console.log('PASS: non-privileged application state and queue insertion commit atomically.');
  await app.query('BEGIN');
  await app.query('INSERT INTO af_compatibility.records VALUES ($1,$2)', [`${id}-rollback`, 'synthetic-org-a']);
  const rolledBackJob = await boss.send('compatibility', { id: `${id}-rollback` }, { db });
  await app.query('ROLLBACK');
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM af_compatibility.records WHERE id=$1', [`${id}-rollback`])).rows[0].count, 0);
  assert.equal(await boss.getJobById('compatibility', rolledBackJob), null);
  console.log('PASS: rollback removes both application state and queue insertion.');
  await admin.query('INSERT INTO af_compatibility.records VALUES ($1,$2)', [`${id}-other`, 'synthetic-org-b']);
  assert.equal((await app.query('SELECT * FROM af_compatibility.records WHERE organization_id=$1', ['synthetic-org-b'])).rowCount, 0);
  await assert.rejects(app.query('INSERT INTO af_compatibility.records VALUES ($1,$2)', [`${id}-forged`, 'synthetic-org-b']), /row-level security/);
  await assert.rejects(app.query('CREATE TABLE af_compatibility.forbidden (id int)'), /permission denied/);
  console.log('PASS: database RLS denies cross-organization reads/writes; runtime cannot perform DDL.');
} finally {
  await boss.stop();
  await app.end();
  await admin.end();
}
