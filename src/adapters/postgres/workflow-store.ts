import { isDeepStrictEqual } from 'node:util';
import type { EvidenceContext } from '../../core/contracts.js';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { ProjectConfiguration } from '../../core/configuration.js';
import { createRun, evidenceContext, transition, type Command, type Run, type Scope } from '../../core/workflow.js';
import type { WorkflowStore } from '../../ports/workflow-store.js';

export type TransactionEffect = (client: PoolClient, scope: Scope, run: Run) => Promise<void>;
export class PostgresWorkflowStore implements WorkflowStore {
  readonly pool: Pool;
  constructor(url: string, private readonly effect?: TransactionEffect) { this.pool = new Pool({ connectionString: url, max: 4 }); }
  async close(): Promise<void> { await this.pool.end(); }
  async transaction<T>(operation: (client: PoolClient) => Promise<T>, connection?: PoolClient): Promise<T> {
    const client = connection ?? await this.pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { if (!connection) client.release(); }
  }
  private async authorize(client: PoolClient, scope: Scope, approve = false): Promise<string> {
    const result = await client.query<{ owner_id: string; can_write: boolean; can_approve: boolean }>('SELECT owner_id, can_write, can_approve FROM factory.memberships WHERE database_role=session_user AND organization_id=$1 AND project_id=$2', [scope.organizationId, scope.projectId]);
    const member = result.rows[0];
    if (!member?.can_write || (approve && !member.can_approve)) throw new Error('Operation is not authorized for this project.');
    return member.owner_id;
  }
  async authorizeJob(scope: Scope, context: EvidenceContext): Promise<Scope> {
    const client = await this.pool.connect();
    try {
      await this.authorize(client, scope);
      const result = await client.query<{ organization_id: string; project_id: string; state: Run }>(
        'SELECT organization_id, project_id, state FROM factory.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3',
        [scope.organizationId, scope.projectId, context.runId]);
      const row = result.rows[0];
      if (!row || !isDeepStrictEqual(evidenceContext(row.state), context)) throw new Error('Synthetic job is outside the authorized context.');
      return { organizationId: row.organization_id, projectId: row.project_id };
    } finally { client.release(); }
  }
  async create(scope: Scope, id: string, config: ProjectConfiguration): Promise<Run> {
    return this.transaction((client) => this.createInTransaction(client, scope, id, config));
  }
  async createInTransaction(client: PoolClient, scope: Scope, id: string, config: ProjectConfiguration): Promise<Run> {
    const owner = await this.authorize(client, scope);
    if (owner !== config.workItem.ownerId || scope.projectId !== config.workItem.projectId) throw new Error('Task ownership does not match authorized project.');
    const run = createRun(id, config);
    await client.query('INSERT INTO factory.runs VALUES ($1,$2,$3,$4,$5)', [scope.organizationId, scope.projectId, id, run.version, run]);
    await client.query('INSERT INTO factory.revisions VALUES ($1,$2,$3,$4,$5)', [scope.organizationId, scope.projectId, id, config.plan.revision, config]);
    return run;
  }
  async get(scope: Scope, id: string): Promise<Run> {
    const result = await this.pool.query<{ state: Run }>('SELECT state FROM factory.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3', [scope.organizationId, scope.projectId, id]);
    if (!result.rows[0]) throw new Error('Run is unavailable in the authorized scope.');
    return result.rows[0].state;
  }
  async findById(scope: Scope, id: string): Promise<Run | undefined> {
    const result = await this.pool.query<{ state: Run }>('SELECT state FROM factory.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3', [scope.organizationId, scope.projectId, id]);
    return result.rows[0]?.state;
  }
  async findByOrigin(scope: Scope, provider: string, reference: string): Promise<Run | undefined> {
    const result = await this.pool.query<{ state: Run }>(`SELECT state FROM factory.runs
      WHERE organization_id=$1 AND project_id=$2
        AND state->'config'->'workItem'->'origin'->>'kind'='external-ticket'
        AND state->'config'->'workItem'->'origin'->>'provider'=$3
        AND state->'config'->'workItem'->'origin'->>'reference'=$4
      ORDER BY id DESC LIMIT 1`, [scope.organizationId, scope.projectId, provider, reference]);
    return result.rows[0]?.state;
  }
  async getForUpdate(client: PoolClient, scope: Scope, id: string): Promise<Run> {
    await this.authorize(client, scope);
    const result = await client.query<{ state: Run }>('SELECT state FROM factory.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE', [scope.organizationId, scope.projectId, id]);
    if (!result.rows[0]) throw new Error('Run is unavailable in the authorized scope.');
    return result.rows[0].state;
  }
  async apply(scope: Scope, id: string, expectedVersion: number, eventId: string, command: Command): Promise<Run> {
    return this.transaction((client) => this.applyInTransaction(client, scope, id, expectedVersion, eventId, command));
  }
  async applyInTransaction(client: PoolClient, scope: Scope, id: string, expectedVersion: number, eventId: string, command: Command): Promise<Run> {
      await this.authorize(client, scope, ['approve', 'reject', 'accept'].includes(command.type));
      const key = [scope.organizationId, scope.projectId, id];
      const record = await client.query<{ state: Run }>('SELECT state FROM factory.runs WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE', key);
      const current = record.rows[0]?.state;
      if (!current) throw new Error('Run is unavailable in the authorized scope.');
      const digest = createHash('sha256').update(JSON.stringify({ expectedVersion, command })).digest('hex');
      const receipt = await client.query<{ digest: string; result: Run }>('SELECT digest,result FROM factory.receipts WHERE organization_id=$1 AND project_id=$2 AND run_id=$3 AND event_id=$4', [...key, eventId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].digest !== digest) throw new Error('Idempotency key was reused with different content.');
        return receipt.rows[0].result;
      }
      if (current.version !== expectedVersion) throw new Error('Stale workflow version.');
      const next = transition(current, command);
      await client.query('UPDATE factory.runs SET state=$4, version=$5 WHERE organization_id=$1 AND project_id=$2 AND id=$3', [...key, next, next.version]);
      if (command.type === 'revise') await client.query('INSERT INTO factory.revisions VALUES ($1,$2,$3,$4,$5)', [...key, next.config.plan.revision, next.config]);
      await client.query('INSERT INTO factory.events VALUES ($1,$2,$3,$4,session_user,$5)', [...key, next.version, command]);
      await client.query('INSERT INTO factory.receipts VALUES ($1,$2,$3,$4,$5,$6)', [...key, eventId, digest, next]);
      await this.effect?.(client, scope, next);
      return next;
  }
}
