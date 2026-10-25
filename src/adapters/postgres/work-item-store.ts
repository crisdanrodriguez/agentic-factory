import { operationDigest } from '../intake-digest.js';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { workItemSchema } from '../../core/contracts.js';
import { fail, parseRequest, revisionVersion, validIdentifier, type IntakeOperation, type IntakeRecord, type IntakeSource } from '../../core/intake.js';
import type { Scope } from '../../core/workflow.js';
import type { WorkItemStore } from '../../ports/work-item-store.js';

type Row = { id: string; owner_id: string; project_id: string; version: number; objective: string; context: string; actor: string; source_kind: 'file' | 'cli' | 'github'; origin_provider: string | null; origin_reference: string | null; origin_updated_at: string | null; digest: string };
function record(row: Row): IntakeRecord {
  const origin = row.source_kind === 'github' ? { kind: 'external-ticket' as const, provider: row.origin_provider ?? 'github', reference: row.origin_reference ?? 'unknown' } : { kind: 'local' as const };
  return { workItem: workItemSchema.parse({ id: row.id, ownerId: row.owner_id, projectId: row.project_id, revision: `r${row.version}`, objective: row.objective, context: row.context, origin }), version: row.version, actor: row.actor, sourceKind: row.source_kind, digest: row.digest, ...(row.origin_updated_at ? { originUpdatedAt: new Date(row.origin_updated_at).toISOString() } : {}) };
}
export class PostgresWorkItemStore implements WorkItemStore {
  readonly pool: Pool;
  constructor(url: string) { this.pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 }); }
  async close(): Promise<void> { await this.pool.end(); }
  private async read(client: PoolClient, scope: Scope, id: string, version?: number): Promise<IntakeRecord> {
    const result = await client.query<Row>(`SELECT r.* FROM factory.intake_revisions r JOIN factory.intake_heads h USING (organization_id,project_id,id)
      WHERE r.organization_id=$1 AND r.project_id=$2 AND r.id=$3 AND r.version=COALESCE($4,h.version)`, [scope.organizationId, scope.projectId, id, version ?? null]);
    if (!result.rows[0]) fail('WorkItem is unavailable in the authorized scope.');
    return record(result.rows[0]);
  }
  async get(scope: Scope, id: string, revision?: string): Promise<IntakeRecord> {
    validIdentifier(id);
    const version = revision === undefined ? undefined : revisionVersion(revision);
    const client = await this.pool.connect();
    try { return await this.read(client, scope, id, version); } finally { client.release(); }
  }
  async getByOrigin(scope: Scope, provider: string, reference: string): Promise<IntakeRecord | undefined> {
    validIdentifier(provider); if (!reference || reference.length > 512) fail('Invalid origin reference.');
    const client = await this.pool.connect();
    try {
      const result = await client.query<Row>(`SELECT r.* FROM factory.intake_revisions r JOIN factory.intake_heads h USING (organization_id,project_id,id)
        WHERE r.organization_id=$1 AND r.project_id=$2 AND r.origin_provider=$3 AND r.origin_reference=$4
        ORDER BY r.version DESC LIMIT 1`, [scope.organizationId, scope.projectId, provider, reference]);
      return result.rows[0] ? record(result.rows[0]) : undefined;
    } finally { client.release(); }
  }
  async ingest(scope: Scope, operation: IntakeOperation, source: IntakeSource): Promise<IntakeRecord> {
    scope = { organizationId: validIdentifier(scope.organizationId), projectId: validIdentifier(scope.projectId) };
    // Snapshot caller-owned bytes before any asynchronous operation.
    source = { kind: source.kind, bytes: Buffer.from(source.bytes), ...(source.origin ? { origin: { ...source.origin } } : {}) };
    operation = { ...operation };
    const request = parseRequest(source);
    validIdentifier(operation.key);
    const expected = operation.kind === 'revise' ? revisionVersion(operation.expectedRevision) : 0;
    if (operation.kind === 'revise') validIdentifier(operation.id);
    const digest = operationDigest(operation, source);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const membership = await client.query<{ owner_id: string; actor: string }>(`SELECT owner_id, session_user AS actor FROM factory.memberships
        WHERE database_role=session_user AND organization_id=$1 AND project_id=$2 AND can_write`, [scope.organizationId, scope.projectId]);
      const member = membership.rows[0];
      if (!member) fail('Intake write is not authorized for this project.');
      const owner = validIdentifier(member.owner_id);
      const key = [scope.organizationId, scope.projectId, member.actor, operation.kind, operation.key];
      // Serialize equal receipt keys; hash collisions only serialize unrelated operations.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(key)]);
      const previous = await client.query<{ digest: string; id: string; version: number }>(`SELECT digest,id,version FROM factory.intake_receipts
        WHERE organization_id=$1 AND project_id=$2 AND actor=$3 AND operation=$4 AND key=$5`, key);
      const receipt = previous.rows[0];
      if (receipt) {
        if (receipt.digest !== digest) fail('Idempotency key conflicts with an earlier request.');
        const result = await this.read(client, scope, receipt.id, receipt.version);
        await client.query('COMMIT'); return result;
      }
      const id = operation.kind === 'create' ? randomUUID() : operation.id;
      const version = expected + 1;
      const origin = source.kind === 'github' && source.origin
        ? { kind: 'external-ticket' as const, provider: source.origin.provider, reference: source.origin.reference }
        : { kind: 'local' as const };
      const item = workItemSchema.safeParse({ ...request, id, ownerId: owner, projectId: scope.projectId, revision: `r${version}`, origin });
      if (!item.success) fail('Invalid authorized WorkItem configuration.');
      const identity = [scope.organizationId, scope.projectId, id];
      if (operation.kind === 'create') {
        await client.query('INSERT INTO factory.intake_heads VALUES ($1,$2,$3,$4,1)', [...identity, owner]);
      } else {
        const changed = await client.query(`UPDATE factory.intake_heads SET version=version+1
          WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND version=$4 AND owner_id=$5 RETURNING version`, [...identity, expected, owner]);
        if (changed.rowCount !== 1) fail('WorkItem is unavailable or its revision is stale.');
      }
      await client.query(`INSERT INTO factory.intake_revisions
        (organization_id,project_id,id,owner_id,version,objective,context,source_kind,original,origin_provider,origin_reference,origin_updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [...identity, owner, version, request.objective, request.context, source.kind, source.bytes, source.origin?.provider ?? null, source.origin?.reference ?? null, source.origin?.updatedAt ?? null]);
      await client.query(`INSERT INTO factory.intake_receipts (organization_id,project_id,actor,operation,key,owner_id,digest,id,version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [...key, owner, digest, id, version]);
      const result = await this.read(client, scope, id, version);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
