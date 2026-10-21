/*
Upstream: https://github.com/timgit/pg-boss/blob/2c1005b744952360e999c2000e155a1bfebb8951/src/types.ts
Exact interface definitions restored from pg-boss 12.38.0.

The MIT License (MIT)

Copyright (c) 2016 Tim Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
export interface CompatibilityFlags {
  /**
   * Fetch jobs with an atomic `UPDATE ... RETURNING` (plus a `state < 'active'` recheck)
   * instead of `SELECT FOR UPDATE SKIP LOCKED`, for engines where SKIP LOCKED performs
   * poorly or skips rows (e.g. CockroachDB).
   */
  noSkipLocked?: boolean;
  /**
   * Run `complete`, `fail`, and supervisor expiry as split statements inside a
   * transaction instead of one multi-mutation CTE, for engines that reject "multiple
   * mutations of the same table" in one statement (e.g. CockroachDB). (Coercing
   * text-encoded integers back to numbers is keyed on `backend === 'cockroachdb'`.)
   */
  noMultiMutationCte?: boolean;
  /** Create the job table without `PARTITION BY LIST` (also disables per-queue `partition: true`). */
  noTablePartitioning?: boolean;
  /** Omit `DEFERRABLE INITIALLY DEFERRED` on foreign keys. */
  noDeferrableConstraints?: boolean;
  /** Disable advisory locks (`pg_advisory_xact_lock`) used to coordinate schema creation and migrations. */
  noAdvisoryLocks?: boolean;
  /** Omit the `INCLUDE` clause on covering indexes. */
  noCoveringIndexes?: boolean;
  /**
   * Declare each table's primary key, indexes and constraints inside its `CREATE TABLE` when
   * installing a schema, instead of as statements after it. CockroachDB runs every standalone
   * index or primary key as a separate schema-change job after commit, which made a fresh install
   * take ~15 seconds; inline they are part of the table. Uses CockroachDB's inline `INDEX` syntax,
   * so no other backend sets it. Installs only: migrations are unaffected.
   */
  inlineTableIndexes?: boolean;
  /**
   * The engine refuses to write a column inside the transaction that added it. CockroachDB runs
   * `ADD COLUMN` as a schema-change job and answers an `UPDATE` of that column in the same
   * transaction with "column is being backfilled", so a migration adding a column and seeding it
   * in one pass cannot run. Migrations drop the seeding statement and leave the column on the
   * default the `ADD COLUMN` gave it.
   */
  noAddColumnBackfill?: boolean;
  /**
   * Skip LISTEN/NOTIFY entirely, for engines that don't implement it (e.g. CockroachDB).
   * Suppresses both the producer-side transactional `pg_notify` (which would otherwise error
   * on insert) and the `useListenNotify` listener. Polling delivers jobs. (YugabyteDB does
   * support cluster-wide LISTEN/NOTIFY, so it does NOT set this flag.)
   */
  noListenNotify?: boolean;
  /**
   * The engine lacks (or doesn't populate) `pg_stat_progress_create_index`, so BAM can't tell
   * whether a stuck `in_progress` index build is still running. Set for CockroachDB/YugabyteDB,
   * whose online-DDL job model isn't the PG `CONCURRENTLY` path. When set, BAM reclaims stale
   * commands on the timeout alone and skips drop-then-rebuild healing.
   */
  noIndexProgressView?: boolean;
  /**
   * The engine stores data outside PostgreSQL's heap, so there is no btree page bloat to reclaim
   * and no `REINDEX` in any form. The `CONCURRENTLY` modifier is irrelevant. Both engines reject
   * the plain statement too. Skips the index-bloat maintenance pass entirely, detection included.
   * Set for CockroachDB/YugabyteDB, where the check is not merely useless but unusable: CockroachDB
   * has no `pg_relation_size()` and rejects `reltuples / relpages`, while YugabyteDB reports both
   * `relpages` and `pg_relation_size()` as 0 for every relation.
   */
  noReindex?: boolean;
  /**
   * The engine has no PostgreSQL-style vacuum to monitor: reclamation is governed by the engine's
   * own GC (CockroachDB's MVCC GC TTL, YugabyteDB's DocDB compaction) rather than by the oldest
   * live snapshot, there is no autovacuum to be disabled, and `pg_stat_activity.backend_xmin` /
   * `pg_replication_slots` do not carry the same meaning. Skips both the `xmin_horizon` and
   * `autovacuum_disabled` checks entirely.
   */
  noMonitorVacuum?: boolean;
  /**
   * The engine will not let a transaction write a row another session wrote after that transaction
   * began. A transactional worker's heartbeat is exactly that shape: `touch()` refreshes
   * `heartbeat_on` on the claimed row from a pooled connection, by design, so the job stays visibly
   * `active` while the handler runs. Under CockroachDB's serializable isolation that write lands
   * above the handler transaction's timestamp, and the completion pg-boss runs inside the
   * transaction then fails with a `40001` WriteTooOldError. The transaction has already returned
   * rows to the client, so there is nothing left to refresh and the batch cannot be retried in
   * place. When set, `work()` rejects `transactional` on a queue that configures `heartbeatSeconds`
   * rather than shipping a worker that fails every batch. (YugabyteDB's snapshot isolation makes the
   * second write wait rather than abort, so it does NOT set this flag.)
   */
  noTransactionalHeartbeat?: boolean;
}

export interface ResolvedConstructorOptions extends ConstructorOptions, CompatibilityFlags {
  schema: string;
  clock: Clock;
  monitorIntervalSeconds: number;
  cronMonitorIntervalSeconds: number;
  maintenanceIntervalSeconds: number;
  bamIntervalSeconds: number;
  flowIntervalSeconds: number;
  reindexIntervalSeconds: number;
  registerInstance: boolean;
  instanceHeartbeatSeconds: number;
}
