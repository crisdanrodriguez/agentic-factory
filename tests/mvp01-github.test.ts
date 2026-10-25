import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubIssueIntake, authorizeIssue } from '../src/core/github-intake.js';
import type { IntakeOperation, IntakeRecord, IntakeSource } from '../src/core/intake.js';
import type { WorkItem } from '../src/core/contracts.js';
import type { WorkItemStore } from '../src/ports/work-item-store.js';
import type { WorkflowStore } from '../src/ports/workflow-store.js';
import type { PlanRefiner } from '../src/ports/plan-refiner.js';
import { RevisionBoundPlanService } from '../src/core/plan-approval.js';
import type { ProjectConfiguration } from '../src/core/configuration.js';
import type { Run, Scope } from '../src/core/workflow.js';
import { readFileSync } from 'node:fs';
import { GitHubIssuePoller } from '../src/adapters/github/issue-poller.js';
import { formatPlanComment } from '../src/core/github-comments.js';
import { AuthorizedCodexPlanRefiner } from '../src/adapters/codex/plan-refiner.js';
import { CodexCliPlanTransport } from '../src/adapters/codex/cli-transport.js';
import { generateKeyPairSync } from 'node:crypto';
import { GitHubAppCommentWriter, GitHubAppInstallation, GitHubAppIssueReader, NodeGitHubHttpsTransport, parseInstallationRepositoryPage, parseInstallationTokenResponse, parseIssueListResponse } from '../src/adapters/github/rest.js';
import { GitHubMvpCoordinator, type MvpCheckpoint, type GitHubMvpCheckpointStore } from '../src/core/github-mvp.js';
import type { GitHubIssuePolling } from '../src/ports/github-api.js';
import { createRun, transition } from '../src/core/workflow.js';

const issue = { installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', issueId: 11, issueNumber: 4, senderId: 13, senderLogin: 'owner', title: 'Add deterministic parser', body: 'Record only.', action: 'opened' as const, updatedAt: '2026-10-24T00:00:00Z' };
const trust = { installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', ownerId: 'owner-1', projectId: 'demo', authorizedSenderId: 13 };
const record = (source: IntakeSource): IntakeRecord => ({ workItem: { id: 'w1', ownerId: 'owner-1', projectId: 'demo', revision: 'r1', objective: 'Add deterministic parser', context: 'Record only.', origin: source.kind === 'github' ? { kind: 'external-ticket', provider: 'github', reference: 'owner/demo#4' } : { kind: 'local' } } satisfies WorkItem, version: 1, actor: 'runtime', sourceKind: source.kind, digest: 'd'.repeat(64) });

test('MVP-01 GitHub issue intake binds installation, repository and authorized sender', async () => {
  const calls: { scope: Scope; operation: IntakeOperation; source: IntakeSource }[] = [];
  const store: WorkItemStore = { async ingest(scope, operation, source) { calls.push({ scope, operation, source }); return record(source); }, async getByOrigin() { return undefined; }, async get() { throw new Error('unused'); }, async close() {} };
  const result = await new GitHubIssueIntake(store, trust).ingest(issue);
  assert.deepEqual(result.workItem.origin, { kind: 'external-ticket', provider: 'github', reference: 'owner/demo#4' });
  assert.equal(calls[0]?.operation.key, 'github-issue:11');
  assert.deepEqual(calls[0]?.scope, { organizationId: 'owner-1', projectId: 'demo' });
  assert.equal(calls[0]?.source.kind, 'github');
});

test('MVP-01 repeats are idempotent and edits revise the existing canonical WorkItem', async () => {
  const calls: IntakeOperation[] = [];
  const existing = record({ kind: 'github', bytes: Buffer.from('{}'), origin: { provider: 'github', reference: 'owner/demo#4' } }); let originUpdatedAt = '2026-10-24T00:00:00.000Z';
  const store: WorkItemStore = {
    async ingest(_scope, operation) { calls.push(operation); if (operation.kind === 'revise') originUpdatedAt = '2026-10-24T00:01:00.000Z'; return existing; },
    async getByOrigin() { return { ...existing, originUpdatedAt }; },
    async get() { return existing; }, async close() {},
  };
  const intake = new GitHubIssueIntake(store, trust);
  await intake.ingest(issue); await intake.ingest(issue);
  await intake.ingest({ ...issue, action: 'edited', updatedAt: '2026-10-24T00:01:00Z', body: 'Revised.' });
  assert.deepEqual(calls.map((call) => call.kind), ['create', 'create', 'revise']);
  assert.equal(calls[2]?.kind === 'revise' ? calls[2].expectedRevision : '', 'r1');
  assert.deepEqual(await intake.ingest({ ...issue, action: 'edited', updatedAt: '2026-10-24T00:00:30Z', body: 'Out of order.' }), { ...existing, originUpdatedAt: '2026-10-24T00:01:00.000Z' });
});

test('MVP-01 poller separates read-only discovery from intake and rejects unauthorized events', async () => {
  const store: WorkItemStore = { async ingest(_scope, _operation, source) { return record(source); }, async getByOrigin() { return undefined; }, async get() { throw new Error('unused'); }, async close() {} };
  const reader = { async listIssues() { return [issue, { ...issue, senderId: 99 }]; } };
  const result = await new GitHubIssuePoller(reader, new GitHubIssueIntake(store, trust)).pollOnce(new AbortController().signal);
  assert.equal(result.accepted.length, 1); assert.equal(result.rejected, 1);
});

test('MVP-01 comments are revision-bound and bounded', () => {
  const body = formatPlanComment({ kind: 'plan', revision: 'plan-1', policyRevision: 'policy-1', summary: 'Synthetic plan.' });
  assert.match(body, /Revision: plan-1/);
  assert.throws(() => formatPlanComment({ kind: 'clarification', revision: 'r1', question: '\u0000' }), /bounds/);
});

test('MVP-01 Codex refinement requires explicit authorization and a bounded call budget', async () => {
  const config = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
  let calls = 0;
  const transport = { async refine() { calls++; return config; } };
  const denied = new AuthorizedCodexPlanRefiner(transport, { authorized: false, model: 'codex-local', maxCalls: 1, maxOutputBytes: 10000 });
  await assert.rejects(denied.refine({ workItem: config.workItem, sourceRevision: config.workItem.revision }), /not locally authorized/);
  const allowed = new AuthorizedCodexPlanRefiner(transport, { authorized: true, model: 'codex-local', maxCalls: 1, maxOutputBytes: 10000 });
  await allowed.refine({ workItem: config.workItem, sourceRevision: config.workItem.revision });
  await assert.rejects(allowed.refine({ workItem: config.workItem, sourceRevision: config.workItem.revision }), /budget exhausted/);
  assert.equal(calls, 1);
});

test('MVP-01 Codex CLI transport is disabled without explicit local authorization', async () => {
  const transport = new CodexCliPlanTransport({ executable: '/does/not/run', workspace: '/private/tmp', model: 'codex-local', timeoutMs: 1000, maxOutputBytes: 1000, authorized: false });
  await assert.rejects(transport.refine({ workItem: record({ kind: 'github', bytes: Buffer.from('{}'), origin: { provider: 'github', reference: 'owner/demo#4' } }).workItem, sourceRevision: 'r1', model: 'codex-local', maxOutputBytes: 1000 }, new AbortController().signal), /not locally authorized/);
});

test('MVP-01 native GitHub transport pins its origin and parses installation issue identity without network access', async () => {
  await assert.rejects(new NodeGitHubHttpsTransport().request('GET', '/../secrets', {}, undefined, new AbortController().signal), /path/);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const responses = [
    { status: 201, headers: {}, body: JSON.stringify({ token: 'ghs_APPID_JWT', expires_at: '2027-01-01T01:00:00Z', permissions: { issues: 'read', metadata: 'read' }, repository_selection: 'selected' }) },
    { status: 200, headers: {}, body: JSON.stringify({ repositories: [{ id: 9, full_name: 'owner/demo' }] }) },
    { status: 200, headers: {}, body: JSON.stringify([{ id: 11, number: 4, title: 'Synthetic', body: 'Record only.', repository_url: 'https://api.github.com/repos/owner/demo', updated_at: '2026-10-24T00:00:00Z', user: { id: 13, login: 'owner' }, repository: { id: 9, full_name: 'owner/demo' } }]) },
  ];
  const calls: { method: 'GET' | 'POST'; path: string; body?: string }[] = [];
  const http = { async request(method: 'GET' | 'POST', path: string, _headers: Record<string, string>, body?: string) { calls.push(body === undefined ? { method, path } : { method, path, body }); const response = responses.shift(); if (!response) throw new Error('unexpected request'); return response; } };
  let cursor: string | null = null; const cursorStore = { async load() { return cursor; }, async save(value: string) { cursor = value; } };
  const installation = new GitHubAppInstallation({ appId: 1, installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, http);
  const reader = new GitHubAppIssueReader(installation, trust, cursorStore);
  const events = await reader.listIssues(new AbortController().signal); await reader.commitCursor();
  assert.equal(events[0]?.issueId, 11); assert.equal(cursor, '2026-10-24T00:00:00Z');
  assert.deepEqual(JSON.parse(calls[0]!.body!), { permissions: { issues: 'read', metadata: 'read' } });
  assert.deepEqual(calls.map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/app/installations/7/access_tokens' },
    { method: 'GET', path: '/installation/repositories?per_page=100&page=1' },
    { method: 'GET', path: '/repos/owner/demo/issues?state=open&per_page=50&page=1' },
  ]);
});

test('MVP-01 discovery uses a read-only token while comment publication obtains a separate full token', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const responses = [
    { status: 201, headers: {}, body: JSON.stringify({ token: 'ghs_APPID_JWT', expires_at: '2027-01-01T01:00:00Z', permissions: { issues: 'read', metadata: 'read' } }) },
    { status: 200, headers: {}, body: JSON.stringify({ repositories: [{ id: 9, full_name: 'owner/demo' }] }) },
    { status: 200, headers: {}, body: JSON.stringify([{ id: 11, number: 4, title: 'Synthetic', body: 'Record only.', repository_url: 'https://api.github.com/repos/owner/demo', updated_at: '2026-10-24T00:00:00Z', user: { id: 13, login: 'owner' }, repository: { id: 9, full_name: 'owner/demo' } }]) },
    { status: 201, headers: {}, body: JSON.stringify({ token: 'write-token', expires_at: '2027-01-01T01:00:00Z' }) },
    { status: 201, headers: {}, body: '{}' },
  ];
  const calls: { method: 'GET' | 'POST'; path: string; body?: string }[] = [];
  const http = { async request(method: 'GET' | 'POST', path: string, _headers: Record<string, string>, body?: string) { calls.push(body === undefined ? { method, path } : { method, path, body }); const response = responses.shift(); if (!response) throw new Error('unexpected request'); return response; } };
  const installation = new GitHubAppInstallation({ appId: 1, installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, http);
  const reader = new GitHubAppIssueReader(installation, trust, { async load() { return null; }, async save() {} });
  await reader.listIssues(new AbortController().signal);
  const writer = new GitHubAppCommentWriter(installation, trust, { async has() { return false; }, async record() {} });
  await writer.createComment({ repositoryFullName: 'owner/demo', issueNumber: 4, body: 'Synthetic plan.', idempotencyKey: 'plan:owner/demo#4:r1' }, new AbortController().signal);
  assert.deepEqual(JSON.parse(calls[0]!.body!), { permissions: { issues: 'read', metadata: 'read' } });
  assert.equal(calls[3]!.body, '{}');
  assert.equal(calls[4]!.method, 'POST');
});

test('MVP-01 accepts bounded legacy and stateless token formats with response metadata', () => {
  const expires = '2027-01-01T01:00:00Z';
  assert.equal(parseInstallationTokenResponse(JSON.stringify({ token: 'ghs_legacy-token', expires_at: expires, permissions: { issues: 'read', metadata: 'read' } }), { issues: 'read', metadata: 'read' }, Date.parse('2026-01-01T00:00:00Z')).token, 'ghs_legacy-token');
  assert.equal(parseInstallationTokenResponse(JSON.stringify({ token: 'ghs_APPID_JWT', expires_at: expires, permissions: { issues: 'read', metadata: 'read' }, repository_selection: 'selected' }), { issues: 'read', metadata: 'read' }, Date.parse('2026-01-01T00:00:00Z')).token, 'ghs_APPID_JWT');
});

test('MVP-01 rejects malformed, expired, and overprivileged installation tokens', () => {
  const read = { issues: 'read' as const, metadata: 'read' as const };
  const future = '2027-01-01T01:00:00Z';
  assert.throws(() => parseInstallationTokenResponse(JSON.stringify({ expires_at: future, permissions: read }), read), /TOKEN_MISSING_OR_INVALID_TYPE/);
  assert.throws(() => parseInstallationTokenResponse(JSON.stringify({ token: 'ghs_valid', expires_at: '2020-01-01T00:00:00Z', permissions: read }), read), /TOKEN_EXPIRATION_INVALID/);
  assert.throws(() => parseInstallationTokenResponse(JSON.stringify({ token: 'ghs_valid', expires_at: future, permissions: { issues: 'write', metadata: 'read' } }), read), /TOKEN_PERMISSIONS_MISMATCH/);
  assert.throws(() => parseInstallationTokenResponse(JSON.stringify({ token: 'ghs_valid', expires_at: future, permissions: { issues: 'read' } }), read), /TOKEN_PERMISSIONS_MISMATCH/);
  assert.throws(() => parseInstallationTokenResponse('{not-json}', read), /TOKEN_RESPONSE_SCHEMA_INVALID/);
});

test('MVP-01 rejects a non-201 token exchange without exposing response content', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const http = { async request() { return { status: 200, headers: {}, body: JSON.stringify({ token: 'ghs_valid', expires_at: '2027-01-01T01:00:00Z' }) }; } };
  const installation = new GitHubAppInstallation({ appId: 1, installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, http);
  await assert.rejects(installation.accessToken(new AbortController().signal, { issues: 'read', metadata: 'read' }), /HTTP_NON_201:200/);
});

test('MVP-01 parses installation repositories with official extra fields and bounded pagination', () => {
  const config = { repositoryId: 9, repositoryFullName: 'owner/demo' };
  const first = parseInstallationRepositoryPage(JSON.stringify({ total_count: 1, repositories: [{ id: 9, full_name: 'owner/demo', private: true, permissions: { issues: 'write' } }] }), config);
  assert.deepEqual(first.diagnostics, { INSTALLATION_REPOSITORY_COUNT: 1, CONFIGURED_REPOSITORY_ID_MATCH: true, CONFIGURED_REPOSITORY_NAME_MATCH: true, REPOSITORY_IDENTITY_CONSISTENCY: true, ENUMERATION_COMPLETE: true });
  for (const [body, expected] of [
    [JSON.stringify({ repositories: [{ id: 8, full_name: 'owner/demo' }] }), { id: false, name: true, consistent: false }],
    [JSON.stringify({ repositories: [{ id: 9, full_name: 'other/demo' }] }), { id: true, name: false, consistent: false }],
    [JSON.stringify({ repositories: [] }), { id: false, name: false, consistent: false }],
  ] as const) {
    const result = parseInstallationRepositoryPage(body, config);
    assert.equal(result.diagnostics.CONFIGURED_REPOSITORY_ID_MATCH, expected.id);
    assert.equal(result.diagnostics.CONFIGURED_REPOSITORY_NAME_MATCH, expected.name);
    assert.equal(result.diagnostics.REPOSITORY_IDENTITY_CONSISTENCY, expected.consistent);
  }
  assert.throws(() => parseInstallationRepositoryPage(JSON.stringify({ repositories: [{ id: 9 }] }), config), /INSTALLATION_REPOSITORY_RESPONSE_SCHEMA_INVALID/);
  assert.throws(() => parseInstallationRepositoryPage(JSON.stringify({ repositories: Array.from({ length: 101 }, (_, id) => ({ id: id + 1, full_name: `owner/repo-${id}` })) }), config), /INSTALLATION_REPOSITORY_RESPONSE_SCHEMA_INVALID/);
  const boundary = parseInstallationRepositoryPage(JSON.stringify({ repositories: Array.from({ length: 100 }, (_, id) => ({ id: id + 1, full_name: `owner/repo-${id}` })) }), config);
  assert.equal(boundary.diagnostics.ENUMERATION_COMPLETE, false);
});

test('MVP-01 parses documented issue metadata without promoting it to authorization', () => {
  const issues = parseIssueListResponse(JSON.stringify([{ id: 11, number: 4, title: 'Synthetic', body: null, repository_url: 'https://api.github.com/repos/owner/demo', updated_at: '2026-10-24T00:00:00Z', state: 'open', locked: false, labels: [{ id: 1, name: 'bug', color: 'fff' }], assignee: null, milestone: null, closed_at: null, user: { id: 13, login: 'owner', type: 'User', site_admin: false }, repository: { id: 9, full_name: 'owner/demo', private: true, url: 'https://api.github.com/repos/owner/demo' } }]));
  assert.equal(issues[0]?.body, null);
  assert.equal(issues[0]?.user.id, 13);
  assert.equal(issues[0]?.repository?.full_name, 'owner/demo');
  assert.equal(issues[0]?.pull_request, undefined);
  assert.throws(() => parseIssueListResponse(JSON.stringify([{ id: 11, number: 4, title: 'Bad', body: null, repository_url: 'not-a-url', updated_at: 'invalid', user: { id: 13, login: 'owner' } }])), /GITHUB_ISSUE_RESPONSE_SCHEMA_INVALID/);
  assert.throws(() => parseIssueListResponse(JSON.stringify([{ id: 11, number: 4, title: 'Bad', body: null, repository_url: 'https://api.github.com/repos/owner/demo', updated_at: '2026-10-24T00:00:00Z', user: { id: '13', login: 'owner' } }])), /GITHUB_ISSUE_RESPONSE_SCHEMA_INVALID:0.user.id=invalid_type/);
});

test('MVP-01 issue discovery binds repository_url and tolerates absent nested repository identity', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issueResponse = (issueFields: Record<string, unknown>) => [
    { status: 201, headers: {}, body: JSON.stringify({ token: 'ghs_APPID_JWT', expires_at: '2027-01-01T01:00:00Z', permissions: { issues: 'read', metadata: 'read' } }) },
    { status: 200, headers: {}, body: JSON.stringify({ repositories: [{ id: 9, full_name: 'owner/demo' }] }) },
    { status: 200, headers: {}, body: JSON.stringify([{ id: 11, number: 4, title: 'Synthetic', body: null, repository_url: 'https://api.github.com/repos/owner/demo', updated_at: '2026-10-24T00:00:00Z', user: { id: 13, login: 'owner' }, ...issueFields }]) },
  ];
  const run = async (issueFields: Record<string, unknown>) => {
    const responses = issueResponse(issueFields);
    const http = { async request() { const response = responses.shift(); if (!response) throw new Error('unexpected request'); return response; } };
    const reader = new GitHubAppIssueReader(new GitHubAppInstallation({ appId: 1, installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, http), trust, { async load() { return null; }, async save() {} });
    return reader.listIssues(new AbortController().signal);
  };
  const absent = await run({});
  assert.equal(absent.length, 1);
  assert.equal(absent[0]!.repositoryId, 9);
  await assert.rejects(run({ repository_url: 'https://api.github.com/repos/other/demo' }), /repository identity mismatch/);
  await assert.rejects(run({ repository: { id: 8, full_name: 'owner/demo' } }), /repository identity mismatch/);
  const pullRequest = await run({ pull_request: { url: 'https://api.github.com/pulls/4' } });
  assert.equal(pullRequest.length, 0);
});

test('MVP-01 coordinator survives repeated polling and approves only the current plan revision', async () => {
  const item = record({ kind: 'github', bytes: Buffer.from('{}'), origin: { provider: 'github', reference: 'owner/demo#4' } }).workItem;
  const config = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
  config.workItem = item; config.plan.workItemId = item.id; config.plan.revision = 'plan-r1';
  const runs = new Map<string, Run>(); const workflows: WorkflowStore = {
    async create(_scope, id, input) { const run = createRun(id, input); runs.set(id, run); return run; },
    async get(_scope, id) { const run = runs.get(id); if (!run) throw new Error('missing run'); return run; },
    async apply(scope, id, version, eventId, command) { const run = await this.get(scope, id); assert.equal(run.version, version); const next = transition(run, command); runs.set(id, next); void eventId; return next; },
  };
  const checkpoints = new Map<string, MvpCheckpoint>(); const checkpointStore: GitHubMvpCheckpointStore = { async load(reference) { return checkpoints.get(reference); }, async save(value) { checkpoints.set(value.reference, structuredClone(value)); } };
  const items: WorkItemStore = { async ingest() { return record({ kind: 'github', bytes: Buffer.from('{}'), origin: { provider: 'github', reference: 'owner/demo#4' } }); }, async get() { return { workItem: item, version: 1, actor: 'runtime', sourceKind: 'github', digest: 'd'.repeat(64) }; }, async getByOrigin() { return undefined; }, async close() {} };
  const refiner: PlanRefiner = { async refine() { return structuredClone(config); } };
  const plans = new RevisionBoundPlanService(workflows, refiner); const poller: GitHubIssuePolling = { async pollOnce() { return { discovered: [], accepted: [{ workItem: item, version: 1, actor: 'runtime', sourceKind: 'github' as const, digest: 'd'.repeat(64) }], rejected: 0 }; } };
  const coordinator = new GitHubMvpCoordinator({ organizationId: 'owner-1', projectId: 'demo' }, trust, poller, items, plans, workflows, checkpointStore);
  const first = await coordinator.synchronize(new AbortController().signal); const second = await coordinator.synchronize(new AbortController().signal);
  assert.equal(first[0]?.runId, second[0]?.runId); assert.equal(runs.size, 1);
  const approved = await coordinator.applyFeedback({ installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', issueNumber: 4, senderId: 13, action: 'approve', planRevision: 'plan-r1', policyRevision: config.plan.policyRevision });
  assert.equal(approved.approval, 'approved');
  await assert.rejects(coordinator.applyFeedback({ installationId: 7, repositoryId: 9, repositoryFullName: 'owner/demo', issueNumber: 4, senderId: 13, action: 'approve', planRevision: 'plan-old', policyRevision: config.plan.policyRevision }), /stale/);
});

test('MVP-01 comment publication is receipt-idempotent and does not retry an uncertain POST', async () => {
  let posts = 0; const installation = { async request(method: 'GET' | 'POST') { assert.equal(method, 'POST'); posts++; return { status: 201, headers: {}, body: '{}' }; } } as unknown as GitHubAppInstallation;
  const keys = new Set<string>(); const receipts = { async has(key: string) { return keys.has(key); }, async record(key: string) { keys.add(key); } };
  const writer = new GitHubAppCommentWriter(installation, trust, receipts);
  const input = { repositoryFullName: 'owner/demo', issueNumber: 4, body: 'Synthetic proposal.', idempotencyKey: 'plan:owner/demo#4:plan-r1' };
  await writer.createComment(input, new AbortController().signal); await writer.createComment(input, new AbortController().signal); assert.equal(posts, 1);
});

test('MVP-01 rejects forged installation, repository or sender identity', () => {
  for (const field of ['installationId', 'repositoryId', 'senderId'] as const) {
    const forged = { ...issue, [field]: issue[field] + 1 };
    assert.throws(() => authorizeIssue({ issue: forged, trust }), /not authorized/);
  }
  assert.throws(() => authorizeIssue({ issue: { ...issue, repositoryFullName: 'attacker/demo' }, trust }), /not authorized/);
});

test('MVP-01 plan approval is bound to the exact WorkItem revision and policy revision', async () => {
  const config = JSON.parse(readFileSync('fixtures/software-general.json', 'utf8')) as ProjectConfiguration;
  const item = config.workItem;
  const calls: string[] = [];
  const workflows: WorkflowStore = {
    async create() { calls.push('create'); return {} as Run; },
    async get() { calls.push('get'); return { config, version: 0 } as Run; },
    async apply(_scope, _id, _version, eventId, command) { calls.push(`${eventId}:${command.type}`); return {} as Run; },
  };
  const refiner: PlanRefiner = { async refine(input) { assert.equal(input.sourceRevision, item.revision); return config; } };
  const service = new RevisionBoundPlanService(workflows, refiner);
  const scope = { organizationId: 'synthetic-org', projectId: item.projectId };
  const refined = await service.refine(scope, item, item.revision);
  await service.createPending(scope, 'run-1', refined);
  await service.approve(scope, 'run-1', 0, config.plan.revision, config.plan.policyRevision);
  assert.deepEqual(calls, ['create', 'get', `approve:run-1:${config.plan.revision}:${config.plan.policyRevision}:approve`]);
  await assert.rejects(service.approve(scope, 'run-1', 0, 'changed-plan', config.plan.policyRevision), /does not match/);
  await assert.rejects(service.approve(scope, 'run-1', 0, config.plan.revision, config.plan.policyRevision, { ...item, revision: 'r2' }), /stale/);
});
