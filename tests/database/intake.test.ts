import { sourceDigest } from '../../src/adapters/intake-digest.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { PostgresWorkItemStore } from '../../src/adapters/postgres/work-item-store.js';
import { cliSource } from '../../src/core/intake.js';

const url = (role = 'af_app') => `postgres://${role}:synthetic-local-runtime-only@127.0.0.1:55432/agentic_factory_local`;
const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };
const source = () => cliSource('Synthetic local software request', 'Record only; do not execute.');
const exec = promisify(execFile);

for (const projectId of ['synthetic-software-project', 'synthetic-ml-project']) {
  test(`AF-023 durable intake and receipt recovery without a plan or run: ${projectId}`, async () => {
    let store = new PostgresWorkItemStore(url()); const local = { ...scope, projectId }; const key = randomUUID();
    const bytes = Buffer.from(' { "objective": "Synthetic request", "context": "  Original text  " }\n');
    const input = { kind: 'file' as const, bytes };
    try {
      const runsBefore = (await store.pool.query('SELECT count(*) FROM factory.runs')).rows;
      const queueBefore = (await store.pool.query('SELECT count(*) FROM factory_queue.job')).rows;
      const first = await store.ingest(local, { kind: 'create', key }, input);
      assert.equal(first.workItem.revision, 'r1'); assert.equal(first.version, 1);
      assert.equal(first.workItem.ownerId, 'synthetic-owner'); assert.equal(first.actor, 'af_app');
      assert.deepEqual(first.workItem.origin, { kind: 'local' });
      assert.equal(first.digest, sourceDigest(bytes));
      const original = await store.pool.query<{ original: Buffer }>('SELECT original FROM factory.intake_revisions WHERE id=$1', [first.workItem.id]);
      assert.deepEqual(original.rows[0]!.original, bytes);
      // Discard the operation result and reconnect: the same receipt survives commit/response loss.
      await store.close(); store = new PostgresWorkItemStore(url());
      assert.deepEqual(await store.ingest(local, { kind: 'create', key }, input), first);
      const second = await store.ingest(local, { kind: 'revise', key: randomUUID(), id: first.workItem.id, expectedRevision: 'r1' }, source());
      assert.equal(second.workItem.revision, 'r2'); assert.equal(second.version, 2);
      assert.deepEqual(await store.get(local, first.workItem.id, 'r1'), first);
      assert.deepEqual(await store.get(local, first.workItem.id), second);
      assert.deepEqual(await store.ingest(local, { kind: 'create', key }, input), first);
      assert.deepEqual((await store.pool.query('SELECT count(*) FROM factory.runs')).rows, runsBefore);
      assert.deepEqual((await store.pool.query('SELECT count(*) FROM factory_queue.job')).rows, queueBefore);
    } finally { await store.close(); }
  });
}
test('AF-023 concurrent identical ingestion produces one receipt and conflicting retries fail', async () => {
  const store = new PostgresWorkItemStore(url()); const key = randomUUID();
  try {
    const results = await Promise.all(Array.from({ length: 4 }, () => store.ingest(scope, { kind: 'create', key }, source())));
    for (const result of results) assert.deepEqual(result, results[0]);
    await assert.rejects(store.ingest(scope, { kind: 'create', key }, cliSource('Changed', 'Conflict')), /conflicts/);
    const id = results[0]!.workItem.id;
    const revisionKey = randomUUID();
    await store.ingest(scope, { kind: 'revise', id, key: revisionKey, expectedRevision: 'r1' }, source());
    await assert.rejects(store.ingest(scope, { kind: 'revise', id, key: revisionKey, expectedRevision: 'r2' }, source()), /conflicts/);
    const competitors = await Promise.allSettled(['a', 'b'].map((suffix) => store.ingest(scope, { kind: 'revise', id, key: `${key}-${suffix}`, expectedRevision: 'r2' }, source())));
    assert.equal(competitors.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await store.get(scope, id)).version, 3);
    assert.equal((await store.pool.query('SELECT count(*)::int AS count FROM factory.intake_revisions WHERE id=$1', [id])).rows[0].count, 3);
  } finally { await store.close(); }
});
test('AF-023 receipt identity includes actor and operation, with organization isolation', async () => {
  const app = new PostgresWorkItemStore(url()); const peer = new PostgresWorkItemStore(url('af_peer')); const other = new PostgresWorkItemStore(url('af_other'));
  const key = randomUUID(); const otherScope = { ...scope, organizationId: 'synthetic-org-b' };
  try {
    const first = await app.ingest(scope, { kind: 'create', key }, source());
    const second = await peer.ingest(scope, { kind: 'create', key }, source());
    assert.notEqual(first.workItem.id, second.workItem.id); assert.equal(second.actor, 'af_peer');
    const third = await other.ingest(otherScope, { kind: 'create', key }, source());
    assert.notEqual(first.workItem.id, third.workItem.id);
    await assert.rejects(app.get(otherScope, third.workItem.id), /unavailable/);
    await assert.rejects(other.get(scope, first.workItem.id), /unavailable/);
    const revised = await app.ingest(scope, { kind: 'revise', key, id: first.workItem.id, expectedRevision: 'r1' }, source());
    assert.equal(revised.version, 2);
    assert.equal((await peer.pool.query('SELECT * FROM factory.intake_receipts WHERE id=$1', [first.workItem.id])).rowCount, 0);
    await assert.rejects(app.ingest(otherScope, { kind: 'create', key: randomUUID() }, source()), /not authorized/);
  } finally { await Promise.all([app.close(), peer.close(), other.close()]); }
});
test('AF-023 SQL enforces forced RLS, owner and actor identity, read-only roles and immutable history', async () => {
  const app = new PostgresWorkItemStore(url()); const reader = new PostgresWorkItemStore(url('af_reader'));
  try {
    const first = await app.ingest(scope, { kind: 'create', key: randomUUID() }, source()); const id = first.workItem.id;
    const roles = (await app.pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=session_user')).rows[0];
    assert.deepEqual(roles, { rolsuper: false, rolbypassrls: false });
    const tables = (await app.pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='factory'::regnamespace AND relname IN ('intake_heads','intake_revisions','intake_receipts')")).rows;
    assert.equal(tables.length, 3); assert.ok(tables.every((r) => r.relrowsecurity && r.relforcerowsecurity));
    assert.deepEqual(await reader.get(scope, id), first);
    await assert.rejects(reader.ingest(scope, { kind: 'create', key: randomUUID() }, source()), /not authorized/);
    for (const [organization, owner] of [['synthetic-org-b', 'synthetic-owner'], [scope.organizationId, 'forged-owner']] as const) {
      await assert.rejects(app.pool.query('INSERT INTO factory.intake_heads VALUES ($1,$2,$3,$4,1)', [organization, scope.projectId, randomUUID(), owner]), /row-level security/);
    }
    assert.equal((await reader.pool.query("SELECT has_table_privilege(session_user,'factory.intake_heads','INSERT') AS can_insert")).rows[0]!.can_insert, false);
    await assert.rejects(reader.pool.query('INSERT INTO factory.intake_heads VALUES ($1,$2,$3,$4,1)', [scope.organizationId, scope.projectId, randomUUID(), 'synthetic-owner']), /permission denied/);
    await assert.rejects(app.pool.query(`INSERT INTO factory.intake_receipts VALUES ($1,$2,'synthetic-owner','af_other','create',$3,$4,$5,1)`, [scope.organizationId, scope.projectId, randomUUID(), 'a'.repeat(64), id]), /row-level security/);
    await assert.rejects(app.pool.query(`INSERT INTO factory.intake_receipts VALUES ($1,$2,'forged-owner',session_user,'create',$3,$4,$5,1)`, [scope.organizationId, scope.projectId, randomUUID(), 'a'.repeat(64), id]), /row-level security/);
    await assert.rejects(app.pool.query(`INSERT INTO factory.intake_revisions
      (organization_id,project_id,id,owner_id,version,actor,objective,context,source_kind,original)
      VALUES ($1,$2,$3,'synthetic-owner',1,'af_other','x','y','cli',$4)`, [scope.organizationId,scope.projectId,id,source().bytes]), /row-level security/);
    await assert.rejects(reader.pool.query(`INSERT INTO factory.intake_receipts VALUES ($1,$2,'synthetic-owner',session_user,'create',$3,$4,$5,1)`, [scope.organizationId,scope.projectId,randomUUID(),'b'.repeat(64),id]), /row-level security/);
    for (const table of ['intake_revisions', 'intake_receipts']) {
      await assert.rejects(app.pool.query(`UPDATE factory.${table} SET owner_id='forged' WHERE id=$1`, [id]), /permission denied/);
      await assert.rejects(app.pool.query(`DELETE FROM factory.${table} WHERE id=$1`, [id]), /permission denied/);
      assert.equal((await app.pool.query(`SELECT * FROM factory.${table} WHERE organization_id='synthetic-org-b'`)).rowCount, 0);
    }
    await assert.rejects(app.pool.query('UPDATE factory.intake_heads SET version=version+2 WHERE id=$1', [id]), /sequential/);
    await assert.rejects(app.pool.query('UPDATE factory.intake_heads SET version=version+1 WHERE id=$1', [id]), /foreign key/);
    await assert.rejects(app.pool.query("UPDATE factory.memberships SET can_write=true"), /permission denied/);
    await assert.rejects(app.pool.query('CREATE TABLE factory.intake_forbidden(id int)'), /permission denied/);
    await assert.rejects(app.pool.query('SET ROLE af_migrator'), /permission denied/);
  } finally { await Promise.all([app.close(), reader.close()]); }
});
test('AF-023 failed transaction leaves no head, revision or receipt and permits retry', async () => {
  const store = new PostgresWorkItemStore(url()); const client = await store.pool.connect(); const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO factory.intake_heads VALUES ($1,$2,$3,$4,1)', [scope.organizationId, scope.projectId, id, 'synthetic-owner']);
    await assert.rejects(client.query(`INSERT INTO factory.intake_revisions
      (organization_id,project_id,id,owner_id,version,objective,context,source_kind,original)
      VALUES ($1,$2,$3,'synthetic-owner',1,'x','y','invalid',$4)`, [scope.organizationId, scope.projectId, id, source().bytes]), /check constraint/);
    await client.query('ROLLBACK');
    for (const table of ['intake_heads', 'intake_revisions', 'intake_receipts']) assert.equal((await client.query(`SELECT * FROM factory.${table} WHERE id=$1`, [id])).rowCount, 0);
    const created = await store.ingest(scope, { kind: 'create', key: id }, source()); assert.equal(created.version, 1);
  } finally { client.release(); await store.close(); }
});
test('AF-023 real CLI create/revise/show preserves input and reports safely without provider or sandbox configuration', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'af023-cli-')); await chmod(root, 0o700);
  const config = join(root, 'installation.json'); const bytes = Buffer.from('{"objective":"Synthetic CLI request","context":"private synthetic phrase"}\n');
  await writeFile(join(root, 'request.json'), bytes, { mode: 0o600 });
  await writeFile(config, JSON.stringify({ revision: '1', databaseUrlEnvironment: 'AF023_TEST_DATABASE', projects: { demo: { ...scope, inbox: root } } }), { mode: 0o600 });
  const env = { PATH: process.env.PATH, FACTORY_INTAKE_CONFIG: config, AF023_TEST_DATABASE: url() };
  const cli = async (args: string[]) => exec(process.execPath, ['.test-build/src/cli/index.js', 'work-item', ...args], { env });
  try {
    const key = randomUUID(); const args = ['create', '--project', 'demo', '--key', key, '--file', 'request.json'];
    const created = await cli(args); assert.equal(created.stderr, ''); assert.ok(!created.stdout.includes('private synthetic phrase'));
    const receipt = JSON.parse(created.stdout) as { id: string; revision: string };
    assert.equal((await cli(args)).stdout, created.stdout);
    await cli(['revise', '--project', 'demo', '--key', key, '--id', receipt.id, '--expected-revision', 'r1', '--objective', 'Synthetic ML research', '--context', 'Unfavorable outcomes are valid']);
    const shown = await cli(['show', '--project', 'demo', '--id', receipt.id, '--revision', 'r1']);
    assert.match(shown.stdout, /private synthetic phrase/);
    assert.deepEqual(await readFile(join(root, 'request.json')), bytes);
    await assert.rejects(cli(['create', '--project', 'demo', '--key', randomUUID(), '--file', '../secret']), (error: Error & { stderr: string }) => !error.stderr.includes(root) && !error.stderr.includes('postgres://'));
    await assert.rejects(exec(process.execPath, ['.test-build/src/cli/index.js', 'work-item', 'show', '--project', 'demo', '--id', receipt.id], { env: { ...env, AF023_TEST_DATABASE: 'postgres://synthetic:secret@127.0.0.1:1/unavailable' } }), (error: Error & { stderr: string }) => !error.stderr.includes('secret') && /Intake operation failed/.test(error.stderr));
  } finally { await rm(root, { recursive: true, force: true }); }
});
for (const phase of ['before-commit', 'after-commit']) {
  test(`AF-023 process interruption ${phase} recovers without duplicate ingestion`, { timeout: 15000 }, async () => {
    const key = randomUUID(); const store = new PostgresWorkItemStore(url());
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { PostgresWorkItemStore } from './.test-build/src/adapters/postgres/work-item-store.js';
      import { cliSource } from './.test-build/src/core/intake.js';
      const store = new PostgresWorkItemStore(process.env.AF023_URL);
      const scope = { organizationId: 'synthetic-org-a', projectId: 'synthetic-software-project' };
      if (process.env.AF023_PHASE === 'before-commit') {
        const client = await store.pool.connect();
        await client.query('BEGIN');
        await client.query('INSERT INTO factory.intake_heads VALUES ($1,$2,$3,$4,1)', [scope.organizationId,scope.projectId,process.env.AF023_KEY,'synthetic-owner']);
      } else {
        await store.ingest(scope, {kind:'create',key:process.env.AF023_KEY}, cliSource('Synthetic local software request','Record only; do not execute.'));
      }
      console.log('ready');
      setInterval(() => {}, 1000);
    `], { env: { PATH: process.env.PATH, AF023_URL: url(), AF023_KEY: key, AF023_PHASE: phase }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Synthetic intake child exited before checkpoint.'); })]);
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      if (phase === 'before-commit') assert.equal((await store.pool.query('SELECT * FROM factory.intake_heads WHERE id=$1', [key])).rowCount, 0);
      const recovered = await store.ingest(scope, { kind: 'create', key }, source());
      assert.equal(recovered.version, 1);
      assert.deepEqual(await store.ingest(scope, { kind: 'create', key }, source()), recovered);
      assert.equal((await store.pool.query('SELECT * FROM factory.intake_receipts WHERE key=$1', [key])).rowCount, 1);
    } finally { child.kill('SIGKILL'); await store.close(); }
  });
}
test('AF-023 identical local IDs remain isolated across organizations at the SQL boundary', async () => {
  const app = new PostgresWorkItemStore(url()); const other = new PostgresWorkItemStore(url('af_other')); const id = randomUUID();
  try {
    for (const [store, organization] of [[app, 'synthetic-org-a'], [other, 'synthetic-org-b']] as const) {
      const client = await store.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO factory.intake_heads VALUES ($1,$2,$3,$4,1)', [organization, scope.projectId, id, 'synthetic-owner']);
        await client.query(`INSERT INTO factory.intake_revisions
          (organization_id,project_id,id,owner_id,version,objective,context,source_kind,original)
          VALUES ($1,$2,$3,'synthetic-owner',1,$4,'Synthetic isolation fixture','cli',$5)`, [organization, scope.projectId, id, organization, cliSource(organization, 'Synthetic isolation fixture').bytes]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    assert.equal((await app.get(scope, id)).workItem.objective, 'synthetic-org-a');
    assert.equal((await other.get({ ...scope, organizationId: 'synthetic-org-b' }, id)).workItem.objective, 'synthetic-org-b');
    assert.equal((await app.pool.query("UPDATE factory.intake_heads SET version=version+1 WHERE organization_id='synthetic-org-b' AND id=$1", [id])).rowCount, 0);
    await assert.rejects(app.get({ ...scope, organizationId: 'synthetic-org-b' }, id), /unavailable/);
  } finally { await Promise.all([app.close(), other.close()]); }
});
