import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { GitHubAppCommentReader, GitHubAppCommentWriter, GitHubAppInstallation, GitHubAppIssueReader } from '../adapters/github/rest.js';
import { FileCommentReceiptStore, FileCursorStore } from '../adapters/github/local-state.js';
import { GitHubIssueIntake } from '../core/github-intake.js';
import { GitHubMvpCoordinator, WorkflowBackedMvpCheckpointStore } from '../core/github-mvp.js';
import { RevisionBoundPlanService } from '../core/plan-approval.js';
import { PostgresWorkItemStore } from '../adapters/postgres/work-item-store.js';
import { PostgresWorkflowStore } from '../adapters/postgres/workflow-store.js';
import { PostgresRefinementIntentStore } from '../adapters/postgres/refinement-intent-store.js';
import { CodexCliPlanTransport } from '../adapters/codex/cli-transport.js';
import { AuthorizedCodexPlanRefiner } from '../adapters/codex/plan-refiner.js';
import { GitHubRefinementWorker } from './github-refinement-worker.js';

const configSchema = z.strictObject({
  intakeDatabaseUrlEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  refinementDatabaseUrlEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  workflowDatabaseUrlEnvironment: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  scope: z.strictObject({ organizationId: z.string().min(1).max(128), projectId: z.string().min(1).max(128) }),
  trust: z.strictObject({ installationId: z.number().int().positive(), repositoryId: z.number().int().positive(), repositoryFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), organizationId: z.string().min(1).max(128), ownerId: z.string().min(1).max(128), projectId: z.string().min(1).max(128), authorizedSenderId: z.number().int().positive() }),
  github: z.strictObject({ appId: z.number().int().positive(), installationId: z.number().int().positive(), repositoryId: z.number().int().positive(), repositoryFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), privateKeyPath: z.string().min(1) }),
  stateDirectory: z.string().min(1),
  codex: z.strictObject({ executable: z.string().min(1), workspace: z.string().min(1), model: z.string().min(1).max(128), timeoutMs: z.number().int().min(1000).max(240000), maxOutputBytes: z.number().int().positive().max(1000000), maxCalls: z.number().int().positive().max(10), authorized: z.boolean(), codexHome: z.string().min(1).optional() }),
  allowGitHubDiscovery: z.boolean(),
  allowGitHubIntake: z.boolean(),
  allowCodexRefinement: z.boolean(),
  allowGitHubWrites: z.boolean(),
  allowOwnerApprovals: z.boolean(),
});
export type GitHubMvpRuntimeConfig = z.infer<typeof configSchema>;

async function privateKey(path: string): Promise<string> { const info = await stat(path); if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('GitHub App private key must be a private regular file.'); return readFile(path, 'utf8'); }

async function createIssueReader(config: GitHubMvpRuntimeConfig) {
  const key = await privateKey(config.github.privateKeyPath);
  const installation = new GitHubAppInstallation({ ...config.github, privateKeyPem: key }, new (await import('../adapters/github/rest.js')).NodeGitHubHttpsTransport());
  return new GitHubAppIssueReader(installation, config.trust, new FileCursorStore(`${config.stateDirectory}/github-cursor.json`));
}

export async function readGitHubMvpConfig(path: string): Promise<GitHubMvpRuntimeConfig> {
  try { return configSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown); } catch { throw new Error('GitHub MVP configuration is invalid or unavailable.'); }
}

/** Discovery-only composition: it has no database pool, queue, or WorkItem store. */
export async function createGitHubDiscoveryRuntime(config: GitHubMvpRuntimeConfig) {
  if (!config.allowGitHubDiscovery) throw new Error('GitHub discovery is not locally authorized.');
  const reader = await createIssueReader(config);
  return { discover: (signal: AbortSignal) => reader.listIssues(signal), close: async () => {} };
}

export type GitHubMvpDatabaseCapability = 'intake' | 'refinement' | 'workflow';

export async function createGitHubMvpRuntime(config: GitHubMvpRuntimeConfig, capability: GitHubMvpDatabaseCapability = 'workflow') {
  if (config.scope.organizationId !== config.trust.organizationId || config.scope.projectId !== config.trust.projectId || config.github.repositoryId !== config.trust.repositoryId || config.github.repositoryFullName !== config.trust.repositoryFullName || config.github.installationId !== config.trust.installationId) throw new Error('GitHub MVP installation and trust configuration do not match.');
  const databaseEnvironment = capability === 'intake' ? config.intakeDatabaseUrlEnvironment : capability === 'refinement' ? config.refinementDatabaseUrlEnvironment : config.workflowDatabaseUrlEnvironment;
  const databaseUrl = process.env[databaseEnvironment]; if (!databaseUrl) throw new Error('GitHub MVP database configuration is unavailable.');
  const key = await privateKey(config.github.privateKeyPath);
  const installation = new GitHubAppInstallation({ ...config.github, privateKeyPem: key }, new (await import('../adapters/github/rest.js')).NodeGitHubHttpsTransport());
  const cursor = new FileCursorStore(`${config.stateDirectory}/github-cursor.json`);
  const receipts = new FileCommentReceiptStore(`${config.stateDirectory}/github-receipts.json`);
  const reader = new GitHubAppIssueReader(installation, config.trust, cursor);
  const commentReader = new GitHubAppCommentReader(installation, config.trust);
  const writer = new GitHubAppCommentWriter(installation, config.trust, receipts);
  const intents = new PostgresRefinementIntentStore(databaseUrl);
  const items = new PostgresWorkItemStore(databaseUrl); const workflows = new PostgresWorkflowStore(databaseUrl);
  const intake = new GitHubIssueIntake(items, config.trust); const poller = new (await import('../adapters/github/issue-poller.js')).GitHubIssuePoller(reader, intake, true);
  const codexConfig = config.codex.codexHome ? { ...config.codex, codexHome: config.codex.codexHome } : { executable: config.codex.executable, workspace: config.codex.workspace, model: config.codex.model, timeoutMs: config.codex.timeoutMs, maxOutputBytes: config.codex.maxOutputBytes, maxCalls: config.codex.maxCalls, authorized: config.codex.authorized };
  const codexRefiner = new AuthorizedCodexPlanRefiner(new CodexCliPlanTransport(codexConfig), { authorized: config.codex.authorized, model: config.codex.model, maxCalls: config.codex.maxCalls, maxOutputBytes: config.codex.maxOutputBytes });
  const plans = new RevisionBoundPlanService(workflows, codexRefiner); const checkpoints = new WorkflowBackedMvpCheckpointStore(config.scope, workflows);
  const coordinator = new GitHubMvpCoordinator(config.scope, config.trust, poller, items, plans, workflows, checkpoints, writer, config.allowGitHubIntake);
  const refinementWorker = new GitHubRefinementWorker(config.scope, intents, items, plans, workflows);
  return {
    discover: async (signal: AbortSignal) => { if (!config.allowGitHubDiscovery) throw new Error('GitHub discovery is not locally authorized.'); return reader.listIssues(signal); },
    intake: async (signal: AbortSignal) => { if (capability !== 'intake') throw new Error('This runtime is not configured with the GitHub intake database identity.'); if (!config.allowGitHubIntake) throw new Error('GitHub intake is not locally authorized.'); return coordinator.intake(signal); },
    refine: async (signal: AbortSignal) => { if (capability !== 'refinement') throw new Error('This runtime is not configured with the refinement database identity.'); if (!config.allowCodexRefinement || !config.codex.authorized) throw new Error('Codex plan refinement is not locally authorized.'); return refinementWorker.once(signal); },
    publishPlan: (reference: string, signal: AbortSignal) => { if (capability !== 'workflow') throw new Error('This runtime is not configured with the workflow database identity.'); return coordinator.publishPlan(reference, config.allowGitHubWrites, signal); },
    async applyOwnerFeedback(issueNumber: number, signal: AbortSignal): Promise<number> {
      if (capability !== 'workflow') throw new Error('This runtime is not configured with the workflow database identity.');
      if (!config.allowOwnerApprovals) throw new Error('GitHub owner approvals are not locally authorized.');
      const feedback = await commentReader.listFeedback(issueNumber, signal); let applied = 0;
      for (const item of feedback) { const receiptKey = `feedback:${item.commentId}`; if (await receipts.has(receiptKey)) continue; await coordinator.applyFeedback(item, signal); await receipts.record(receiptKey); applied++; }
      return applied;
    },
    close: async () => { await Promise.all([items.close(), workflows.close(), intents.close()]); },
  };
}
