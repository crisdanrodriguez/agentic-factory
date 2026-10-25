import { z } from 'zod';
import { validIdentifier, type IntakeOperation, type IntakeRecord, type IntakeSource } from './intake.js';
import type { Scope } from './workflow.js';
import type { WorkItemStore } from '../ports/work-item-store.js';
import type { GitHubIssueSource } from '../ports/github.js';

const issueSchema = z.strictObject({
  installationId: z.number().int().positive(), repositoryId: z.number().int().positive(),
  repositoryFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), issueId: z.number().int().positive(),
  issueNumber: z.number().int().positive(), senderId: z.number().int().positive(),
  senderLogin: z.string().min(1).max(128), title: z.string().trim().min(1).max(4000),
  body: z.string().max(60000), action: z.enum(['opened', 'edited']),
  updatedAt: z.string().datetime({ offset: true }),
});

export class GitHubIntakeError extends Error {}
function reject(): never { throw new GitHubIntakeError('GitHub issue is not authorized for this installation.'); }

export function parseIssue(value: unknown) {
  const result = issueSchema.safeParse(value);
  if (!result.success) throw new GitHubIntakeError('GitHub issue payload is invalid.');
  return result.data;
}

export function authorizeIssue(input: GitHubIssueSource): Scope {
  const issue = parseIssue(input.issue);
  const trust = input.trust;
  if (issue.installationId !== trust.installationId || issue.repositoryId !== trust.repositoryId || issue.repositoryFullName !== trust.repositoryFullName || issue.senderId !== trust.authorizedSenderId) reject();
  const [organizationId, projectId] = [validIdentifier(trust.organizationId), validIdentifier(trust.projectId)];
  return { organizationId, projectId };
}

export class GitHubIssueIntake {
  constructor(private readonly store: WorkItemStore, private readonly trust: GitHubIssueSource['trust']) {}

  async ingest(issueValue: unknown): Promise<IntakeRecord> {
    const issue = parseIssue(issueValue);
    const scope = authorizeIssue({ issue, trust: this.trust });
    const source: IntakeSource = {
      kind: 'github',
      bytes: Buffer.from(JSON.stringify({ objective: issue.title, context: issue.body }), 'utf8'),
      origin: { provider: 'github', reference: `${issue.repositoryFullName}#${issue.issueNumber}`, updatedAt: issue.updatedAt },
    };
    const originReference = `${issue.repositoryFullName}#${issue.issueNumber}`;
    // Always reconcile by canonical origin before selecting create/revise. A
    // process interruption can leave the cursor behind an edit, so the reader
    // may classify that next delivery as "opened" even though the WorkItem
    // already exists.
    const existing = await this.store.getByOrigin(scope, 'github', originReference);
    if (existing?.originUpdatedAt && Date.parse(existing.originUpdatedAt) >= Date.parse(issue.updatedAt)) return existing;
    const operation: IntakeOperation = existing
      ? { kind: 'revise', key: `github-issue:${issue.issueId}:${issue.updatedAt}`, id: existing.workItem.id, expectedRevision: existing.workItem.revision }
      : { kind: 'create', key: `github-issue:${issue.issueId}` };
    return this.store.ingest(scope, operation, source);
  }
}
