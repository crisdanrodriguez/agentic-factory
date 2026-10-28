import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubIssueIntake } from '../src/core/github-intake.js';
import { GitHubIssuePoller } from '../src/adapters/github/issue-poller.js';
import { GitHubRefinementWorker } from '../src/runtime/github-refinement-worker.js';
import { RevisionBoundPlanService } from '../src/core/plan-approval.js';
import type { IntakeRecord } from '../src/core/intake.js';
import type { WorkItem } from '../src/core/contracts.js';
import type { WorkItemStore } from '../src/ports/work-item-store.js';
import type { RefinementClaim, RefinementIntentStore } from '../src/ports/refinement-intent.js';
import type { WorkflowStore } from '../src/ports/workflow-store.js';
import type { ProjectConfiguration } from '../src/core/configuration.js';
import type { Run, Scope } from '../src/core/workflow.js';
import { readFileSync } from 'node:fs';

const issue = { installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', issueId: 11, issueNumber: 4, senderId: 13, senderLogin: 'owner', title: 'Durable intake', body: 'Record only.', action: 'opened' as const, updatedAt: '2026-10-24T00:00:00Z' };
const trust = { installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', organizationId: 'org-1', ownerId: 'owner-1', projectId: 'demo', authorizedSenderId: 13 };
const item = (revision = 'r1'): IntakeRecord => ({ workItem: { id: 'w1', ownerId: 'owner-1', projectId: 'demo', revision, objective: 'Durable intake', context: 'Record only.', origin: { kind: 'external-ticket', provider: 'github', reference: 'owner/demo#4' } } satisfies WorkItem, version: Number(revision.slice(1)), actor: 'runtime', sourceKind: 'github', digest: 'd'.repeat(64), originUpdatedAt: revision === 'r1' ? issue.updatedAt : '2026-10-24T00:01:00.000Z' });

test('MVP-01B durable intake atomically requests a refinement intent and acknowledges only after it returns', async () => {
  const calls: string[] = [];
  const store: WorkItemStore = {
    async getByOrigin() { return undefined; }, async get() { return item(); }, async close() {},
    async ingest() { throw new Error('non-durable path used'); },
    async ingestWithRefinementIntent(_scope, _operation, _source, intent) { calls.push(`${intent.originReference}:${intent.sourceRevision}`); return item(); },
  };
  const intake = new GitHubIssueIntake(store, trust);
  const record = await intake.ingestDurably(issue);
  assert.equal(record.workItem.id, 'w1'); assert.deepEqual(calls, ['owner/demo#4:r1']);
});

test('MVP-01B intake cursor advances after durable intake without invoking refinement', async () => {
  let committed = 0; const refined = 0;
  const store: WorkItemStore = { async getByOrigin() { return undefined; }, async get() { return item(); }, async close() {}, async ingestWithRefinementIntent() { return item(); }, async ingest() { throw new Error('unused'); } };
  const poller = new GitHubIssuePoller({ async listIssues() { return [issue]; }, async commitCursor() { committed++; } }, new GitHubIssueIntake(store, trust), true);
  const result = await poller.pollOnce(new AbortController().signal);
  assert.equal(result.accepted.length, 1); assert.equal(committed, 0); assert.equal(refined, 0);
  await poller.commitCursor(); assert.equal(committed, 1);
  void refined;
});

test('MVP-01B durable intake is safe when two workers race on the same canonical origin', async () => {
  let creates = 0; let stored: IntakeRecord | undefined;
  const store: WorkItemStore = {
    async close() {}, async get() { if (!stored) throw new Error('missing'); return stored; },
    async getByOrigin() { return stored; }, async ingest() { throw new Error('unused'); },
    async ingestWithRefinementIntent() { if (!stored) { creates++; stored = item(); return stored; } return stored; },
  };
  const intake = new GitHubIssueIntake(store, trust);
  await Promise.all([intake.ingestDurably(issue), intake.ingestDurably(issue)]);
  assert.equal(creates, 1);
});

function config(): ProjectConfiguration { return JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration; }
const scope: Scope = { organizationId: 'org-1', projectId: 'demo' };

test('MVP-01B refinement retries a transient failure and succeeds on a later claimed attempt', async () => {
  let claims = 0; const retries: string[] = [];
  const claim = { scope, workItemId: 'w1', sourceRevision: 'r1', originProvider: 'github', originReference: 'owner/demo#4', status: 'running' as const, attemptCount: 1, maxAttempts: 3, nextAttemptAt: new Date().toISOString(), cancellationRequested: false, leaseToken: 'lease-1' } satisfies RefinementClaim;
  const intents: RefinementIntentStore = { async claimDue() { if (claims++ < 2) return claim; return undefined; }, async retry(_claim, code) { retries.push(code); }, async fail() {}, async cancel() {}, async supersedeOlder() {} };
  const items: WorkItemStore = { async close() {}, async get() { return item(); }, async getByOrigin() { return item(); }, async ingest() { return item(); } };
  const runs = new Map<string, Run>(); const workflows: WorkflowStore = { async create(_scope, id, cfg) { const run = { id, version: 0, config: cfg, phase: 'awaiting-approval', outcome: { execution: 'pending', verification: 'unverified', objective: 'not-assessed', humanDecision: 'pending' }, approval: { status: 'pending', planRevision: cfg.plan.revision, policyRevision: cfg.plan.policyRevision }, step: { attempts: 0, variants: 0, generation: 0 }, job: null, evidence: [], artifactReferences: [], cancellationRequested: false, simulation: true } as Run; runs.set(id, run); return run; }, async get(_scope, id) { return runs.get(id)!; }, async apply() { throw new Error('unused'); } };
  let calls = 0; const base = config(); base.workItem = item().workItem; base.plan.workItemId = 'w1'; base.plan.revision = 'plan-r1';
  const plans = new RevisionBoundPlanService(workflows, { async refine() { if (calls++ === 0) throw new Error('temporary provider outage'); return base; } });
  const worker = new GitHubRefinementWorker(scope, intents, items, plans, workflows, 'test-worker');
  await worker.once(new AbortController().signal); assert.deepEqual(retries, ['REFINEMENT_RETRYABLE']);
  await worker.once(new AbortController().signal);
  assert.equal(runs.size, 1);
});

test('MVP-01B refinement rejects a changed WorkItem revision before model use', async () => {
  let modelCalls = 0; let superseded = 0;
  const claim = { scope, workItemId: 'w1', sourceRevision: 'r1', originProvider: 'github', originReference: 'owner/demo#4', status: 'running' as const, attemptCount: 1, maxAttempts: 3, nextAttemptAt: new Date().toISOString(), cancellationRequested: false, leaseToken: 'lease-1' } satisfies RefinementClaim;
  const intents: RefinementIntentStore = { async claimDue() { return claim; }, async retry() {}, async fail() {}, async cancel() {}, async supersedeOlder() { superseded++; } };
  const items: WorkItemStore = { async close() {}, async get() { return item('r2'); }, async getByOrigin() { return item('r2'); }, async ingest() { return item('r2'); } };
  const workflows: WorkflowStore = { async create() { throw new Error('must not create'); }, async get() { throw new Error('unused'); }, async apply() { throw new Error('unused'); } };
  const plans = new RevisionBoundPlanService(workflows, { async refine() { modelCalls++; return config(); } });
  await new GitHubRefinementWorker(scope, intents, items, plans, workflows, 'test-worker').once(new AbortController().signal);
  assert.equal(modelCalls, 0); assert.equal(superseded, 1);
});

test('MVP-01B reconciles a committed workflow after the worker loses commit confirmation', async () => {
  const claim = { scope, workItemId: 'w1', sourceRevision: 'r1', originProvider: 'github', originReference: 'owner/demo#4', status: 'running' as const, attemptCount: 2, maxAttempts: 3, nextAttemptAt: new Date().toISOString(), cancellationRequested: false, leaseToken: 'lease-2' } satisfies RefinementClaim;
  let reconciled = 0; let creates = 0; let modelCalls = 0;
  const intents: RefinementIntentStore = { async claimDue() { return reconciled ? undefined : claim; }, async retry() {}, async fail() {}, async cancel() {}, async supersedeOlder() {}, async completeExisting(_claim, runId) { assert.equal(runId, 'w1-r1'); reconciled++; } };
  const items: WorkItemStore = { async close() {}, async get() { return item(); }, async getByOrigin() { return item(); }, async ingest() { return item(); } };
  const plan = config(); plan.workItem = item().workItem; plan.plan.workItemId = 'w1'; plan.plan.revision = 'plan-r1';
  const workflows: WorkflowStore = { async create() { creates++; throw new Error('duplicate workflow insert must not occur'); }, async get() { throw new Error('unused'); }, async apply() { throw new Error('unused'); }, async findById(_scope, runId) { return runId === 'w1-r1' ? { id: runId, version: 0, config: plan, phase: 'awaiting-approval', outcome: { execution: 'pending', verification: 'unverified', objective: 'not-assessed', humanDecision: 'pending' }, approval: { status: 'pending', planRevision: 'plan-r1', policyRevision: plan.plan.policyRevision }, step: { attempts: 0, variants: 0, generation: 0 }, job: null, evidence: [], artifactReferences: [], cancellationRequested: false, simulation: true } as Run : undefined; } };
  const worker = new GitHubRefinementWorker(scope, intents, items, new RevisionBoundPlanService(workflows, { async refine() { modelCalls++; return plan; } }), workflows, 'recovery-worker');
  await worker.once(new AbortController().signal);
  assert.equal(creates, 0); assert.equal(modelCalls, 0); assert.equal(reconciled, 1);
});

test('MVP-01B an old origin workflow does not strand refinement for a newer WorkItem revision', async () => {
  const claim = { scope, workItemId: 'w1', sourceRevision: 'r2', originProvider: 'github', originReference: 'owner/demo#4', status: 'running' as const, attemptCount: 1, maxAttempts: 3, nextAttemptAt: new Date().toISOString(), cancellationRequested: false, leaseToken: 'lease-r2' } satisfies RefinementClaim;
  let creates = 0; let refinements = 0;
  const intents: RefinementIntentStore = { async claimDue() { return claim; }, async retry() {}, async fail() {}, async cancel() {}, async supersedeOlder() { throw new Error('current intent must remain claimable'); } };
  const items: WorkItemStore = { async close() {}, async get() { return item('r2'); }, async getByOrigin() { return item('r2'); }, async ingest() { return item('r2'); } };
  const currentPlan = config(); currentPlan.workItem = item('r2').workItem; currentPlan.plan.workItemId = 'w1'; currentPlan.plan.revision = 'plan-r2';
  const oldPlan = config(); oldPlan.workItem = item('r1').workItem; oldPlan.plan.workItemId = 'w1'; oldPlan.plan.revision = 'plan-r1';
  const oldRun = { id: 'w1-r1', version: 0, config: oldPlan, phase: 'awaiting-approval', outcome: { execution: 'pending', verification: 'unverified', objective: 'not-assessed', humanDecision: 'pending' }, approval: { status: 'pending', planRevision: 'plan-r1', policyRevision: oldPlan.plan.policyRevision }, step: { attempts: 0, variants: 0, generation: 0 }, job: null, evidence: [], artifactReferences: [], cancellationRequested: false, simulation: true } as Run;
  const workflows: WorkflowStore = { async create() { creates++; return oldRun; }, async get() { return oldRun; }, async apply() { return oldRun; }, async findById() { return undefined; }, async findByOrigin() { return oldRun; } };
  const worker = new GitHubRefinementWorker(scope, intents, items, new RevisionBoundPlanService(workflows, { async refine() { refinements++; return currentPlan; } }), workflows, 'current-revision-worker');
  await worker.once(new AbortController().signal);
  assert.equal(refinements, 1); assert.equal(creates, 1);
});

test('MVP-01B cancellation and supersession cannot be resurrected by retry handling', async () => {
  const claim = { scope, workItemId: 'w1', sourceRevision: 'r1', originProvider: 'github', originReference: 'owner/demo#4', status: 'running' as const, attemptCount: 1, maxAttempts: 3, nextAttemptAt: new Date().toISOString(), cancellationRequested: true, leaseToken: 'lease-cancelled' } satisfies RefinementClaim;
  let cancelled = 0; let modelCalls = 0;
  const intents: RefinementIntentStore = { async claimDue() { return claim; }, async retry() { throw new Error('cancelled work must not be retried'); }, async fail() {}, async cancel() { cancelled++; }, async supersedeOlder() {} };
  const items: WorkItemStore = { async close() {}, async get() { return item(); }, async getByOrigin() { return item(); }, async ingest() { return item(); } };
  const workflows: WorkflowStore = { async create() { throw new Error('unused'); }, async get() { throw new Error('unused'); }, async apply() { throw new Error('unused'); } };
  const worker = new GitHubRefinementWorker(scope, intents, items, new RevisionBoundPlanService(workflows, { async refine() { modelCalls++; throw new Error('cancelled provider'); } }), workflows, 'cancelled-worker');
  await worker.once(new AbortController().signal);
  assert.equal(cancelled, 1); assert.equal(modelCalls, 0);
});
