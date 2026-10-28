import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { Scope } from '../../core/workflow.js';
import type { ProjectConfiguration } from '../../core/configuration.js';
import type { PostgresWorkflowStore } from './workflow-store.js';
import type { RefinementClaim, RefinementIntent, RefinementIntentStore } from '../../ports/refinement-intent.js';

type Row = {
  organization_id: string; project_id: string; work_item_id: string; source_revision: string;
  origin_provider: string; origin_reference: string; status: RefinementIntent['status'];
  attempt_count: number; max_attempts: number; next_attempt_at: Date; lease_token: string | null;
  lease_expires_at: Date | null; cancellation_requested: boolean; plan_run_id: string | null;
};
function map(row: Row): RefinementIntent {
  return {
    scope: { organizationId: row.organization_id, projectId: row.project_id }, workItemId: row.work_item_id,
    sourceRevision: row.source_revision, originProvider: row.origin_provider, originReference: row.origin_reference,
    status: row.status, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at.toISOString(), ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at.toISOString() } : {}),
    cancellationRequested: row.cancellation_requested, ...(row.plan_run_id ? { planRunId: row.plan_run_id } : {}),
  };
}

export class PostgresRefinementIntentStore implements RefinementIntentStore {
  readonly pool: Pool;
  constructor(url: string) { this.pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 }); }
  async close(): Promise<void> { await this.pool.end(); }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>, connection?: PoolClient): Promise<T> {
    const client = connection ?? await this.pool.connect();
    try { if (!connection) await client.query('BEGIN'); const result = await fn(client); if (!connection) await client.query('COMMIT'); return result; }
    catch (error) { if (!connection) await client.query('ROLLBACK'); throw error; }
    finally { if (!connection) client.release(); }
  }
  async claimDue(scope: Scope, workerId: string, leaseSeconds: number): Promise<RefinementClaim | undefined> {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw new Error('Invalid refinement lease.');
    return this.transaction(async (client) => {
      const result = await client.query<Row>(`SELECT * FROM factory.refinement_intents
        WHERE organization_id=$1 AND project_id=$2 AND cancellation_requested=false
          AND ((status='pending' AND next_attempt_at <= clock_timestamp())
            OR (status='running' AND lease_expires_at < clock_timestamp()))
        ORDER BY next_attempt_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [scope.organizationId, scope.projectId]);
      const row = result.rows[0]; if (!row) return undefined;
      const token = `${workerId}:${randomUUID()}`;
      const updated = await client.query<Row>(`UPDATE factory.refinement_intents SET status='running', lease_token=$5,
          lease_expires_at=clock_timestamp()+($6::text || ' seconds')::interval,
          attempt_count=attempt_count+1, updated_at=clock_timestamp()
        WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision=$4
        RETURNING *`, [scope.organizationId, scope.projectId, row.work_item_id, row.source_revision, token, leaseSeconds]);
      return { ...map(updated.rows[0]!), leaseToken: token };
    });
  }
  async retry(claim: RefinementClaim, errorCode: string, delaySeconds: number): Promise<void> {
    if (!/^[A-Z0-9_.-]{1,80}$/.test(errorCode) || !Number.isInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 3600) throw new Error('Invalid refinement retry metadata.');
    await this.transaction(async (client) => {
      const result = await client.query<{ attempt_count: number; max_attempts: number }>(`UPDATE factory.refinement_intents
        SET status=CASE WHEN cancellation_requested THEN 'cancelled' WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
            next_attempt_at=clock_timestamp()+($6::text || ' seconds')::interval, lease_token=NULL, lease_expires_at=NULL,
            last_error=$5, updated_at=clock_timestamp()
        WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision=$4 AND status='running' AND lease_token=$7 AND lease_expires_at > clock_timestamp()
        RETURNING attempt_count,max_attempts`, [claim.scope.organizationId, claim.scope.projectId, claim.workItemId, claim.sourceRevision, errorCode, delaySeconds, claim.leaseToken]);
      if (result.rowCount !== 1) throw new Error('Stale refinement claim.');
    });
  }
  async fail(claim: RefinementClaim, errorCode: string): Promise<void> {
    if (!/^[A-Z0-9_.-]{1,80}$/.test(errorCode)) throw new Error('Invalid refinement failure metadata.');
    await this.transaction(async (client) => {
      const result = await client.query(`UPDATE factory.refinement_intents SET status=CASE WHEN cancellation_requested THEN 'cancelled' ELSE 'failed' END, lease_token=NULL, lease_expires_at=NULL, last_error=$5, updated_at=clock_timestamp()
        WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision=$4 AND status='running' AND lease_token=$6 AND lease_expires_at > clock_timestamp()`, [claim.scope.organizationId, claim.scope.projectId, claim.workItemId, claim.sourceRevision, errorCode, claim.leaseToken]);
      if (result.rowCount !== 1) throw new Error('Stale refinement claim.');
    });
  }
  async cancel(scope: Scope, workItemId: string, sourceRevision: string): Promise<void> {
    await this.pool.query(`UPDATE factory.refinement_intents SET cancellation_requested=true, status='cancelled', lease_token=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
      WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision=$4`, [scope.organizationId, scope.projectId, workItemId, sourceRevision]);
  }
  async supersedeOlder(scope: Scope, workItemId: string, currentRevision: string): Promise<void> {
    const current = Number(currentRevision.slice(1));
    if (!Number.isSafeInteger(current) || current < 1) throw new Error('Invalid refinement revision.');
    await this.pool.query(`UPDATE factory.refinement_intents SET status='superseded', cancellation_requested=true, lease_token=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
      WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND status IN ('pending','running')
        AND substring(source_revision from 2)::integer < $4`, [scope.organizationId, scope.projectId, workItemId, current]);
  }
  async complete(client: PoolClient, claim: RefinementClaim, planRunId: string): Promise<void> {
    const result = await client.query(`UPDATE factory.refinement_intents SET status='succeeded', plan_run_id=$5, lease_token=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
      WHERE organization_id=$1 AND project_id=$2 AND work_item_id=$3 AND source_revision=$4 AND status='running' AND lease_token=$6 AND cancellation_requested=false AND lease_expires_at > clock_timestamp()`, [claim.scope.organizationId, claim.scope.projectId, claim.workItemId, claim.sourceRevision, planRunId, claim.leaseToken]);
    if (result.rowCount !== 1) throw new Error('Refinement claim is stale or cancelled.');
  }
  async completeExisting(claim: RefinementClaim, planRunId: string): Promise<void> {
    await this.transaction(async (client) => this.complete(client, claim, planRunId));
  }
  async completeRefinement(claim: RefinementClaim, planRunId: string, config: ProjectConfiguration, workflows: PostgresWorkflowStore): Promise<void> {
    await this.transaction(async (client) => {
      await workflows.createInTransaction(client, claim.scope, planRunId, config);
      await this.complete(client, claim, planRunId);
    });
  }
}
