import { PgBoss, type JobWithMetadata } from 'pg-boss';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Scope, Run } from '../core/workflow.js';
import { PostgresWorkflowStore } from './postgres/workflow-store.js';

export interface Wake { scope: Scope; runId: string; version: number }
export class WorkflowQueue {
  readonly boss: PgBoss;
  private fatal: Error | undefined;
  constructor(url: string) {
    this.boss = new PgBoss({ connectionString: url, schema: 'factory_queue', migrate: false, supervise: false, schedule: false, registerInstance: false });
    this.boss.on('error', () => { this.fatal = new Error('Queue connection failed.'); });
  }
  async start(): Promise<void> { await this.boss.start(); }
  async close(): Promise<void> { await this.boss.stop(); }
  async publish(client: PoolClient, scope: Scope, run: Run): Promise<void> {
    if (['ready', 'running', 'verifying'].includes(run.phase) || (run.cancellationRequested && run.phase !== 'terminal')) {
      await this.boss.send('workflow', { scope, runId: run.id, version: run.version }, { db: { executeSql: (sql, values) => client.query(sql, values) } });
    } else if (run.phase === 'awaiting-job') {
      await this.defer(client, scope, run);
    }
  }
  /** Persist a bounded-delay reconciliation wake without holding a worker during computation. */
  async defer(client: PoolClient, scope: Scope, run: Run): Promise<void> {
    await this.boss.send('workflow', { scope, runId: run.id, version: run.version }, {
      startAfter: 1, db: { executeSql: (sql, values) => client.query(sql, values) },
    });
  }
  async claim(): Promise<JobWithMetadata<Wake> | undefined> {
    if (this.fatal) throw this.fatal;
    const jobs = await this.boss.fetch<Wake>('workflow', { includeMetadata: true, batchSize: 1 });
    return jobs[0];
  }
  async settle(store: PostgresWorkflowStore, job: JobWithMetadata<Wake>, action: (client: PoolClient) => Promise<void>, connection?: PoolClient): Promise<void> {
    if (this.fatal) throw this.fatal;
    await store.transaction(async (client) => {
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL transaction_timeout='10s'");
      const db = { executeSql: (sql: string, values?: unknown[]) => client.query(sql, values) };
      const current = await this.boss.getJobById<Wake>('workflow', job.id, { db });
      if (!current || current.state !== 'active' || current.retryCount !== job.retryCount) throw new Error('Stale queue attempt cannot apply workflow results.');
      const assertLease = async (): Promise<void> => {
        const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
        // Use persisted claim metadata; the caller cannot extend its own deadline.
        if (now.getTime() >= current.startedOn.getTime() + current.expireInSeconds * 1000) throw new Error('Queue lease has expired.');
      };
      await assertLease();
      const result: unknown = await this.boss.complete('workflow', { id: job.id, retryCount: job.retryCount }, null, { db: { executeSql: (sql, values) => client.query(sql, values) } });
      const response = z.object({ affected: z.number() }).parse(result);
      if (response.affected !== 1) throw new Error('Stale queue attempt cannot apply workflow results.');
      await action(client);
      await assertLease();
    }, connection);
  }
}

/** One coordinator initially. pg-boss still owns job claims, retries and expiration. */
export class SingleWorker {
  private connection: PoolClient | undefined;
  private lost = false;
  private busy = false;
  private readonly onConnectionError = (): void => { this.lost = true; };
  constructor(private readonly store: PostgresWorkflowStore, private readonly queue: WorkflowQueue) {}
  async start(): Promise<void> {
    if (this.connection) throw new Error('Worker already started.');
    this.lost = false;
    const client = await this.store.pool.connect();
    client.on('error', this.onConnectionError);
    try {
      const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(412006,1) AS acquired');
      if (!result.rows[0]!.acquired) throw new Error('Another coordinator is already active.');
      this.connection = client;
    } catch (error) {
      client.removeListener('error', this.onConnectionError); client.release(this.lost); throw error;
    }
  }
  async once(action: (job: JobWithMetadata<Wake>, client: PoolClient) => Promise<void>): Promise<boolean> {
    if (!this.connection || this.lost) throw new Error('Worker does not hold coordinator ownership.');
    if (this.busy) throw new Error('Coordinator is already processing a wake.');
    this.busy = true;
    try {
      await this.queue.boss.supervise('workflow');
      const job = await this.queue.claim();
      if (!job) return false;
      try {
        // The transaction runs on the session holding the coordinator lock. Session
        // loss rolls back its writes before another coordinator can commit results.
        await this.queue.settle(this.store, job, async (client) => {
          if (this.lost) throw new Error('Coordinator ownership lost.');
          const run = await this.store.getForUpdate(client, job.data.scope, job.data.runId);
          if (run.version !== job.data.version || run.phase === 'terminal') return;
          await action(job, client);
          if (this.lost) throw new Error('Coordinator ownership lost.');
        }, this.connection);
      } catch (error) {
        await this.queue.boss.fail('workflow', { id: job.id, retryCount: job.retryCount }, { reason: 'Workflow handler failed; inspect local audit state.' });
        throw error;
      }
      return true;
    } finally { this.busy = false; }
  }
  async close(): Promise<void> {
    if (this.busy) throw new Error('Cannot close a coordinator during a transaction.');
    if (this.connection) {
      try { if (!this.lost) await this.connection.query('SELECT pg_advisory_unlock(412006,1)'); }
      finally { this.connection.removeListener('error', this.onConnectionError); this.connection.release(this.lost); this.connection = undefined; }
    }
  }
}
