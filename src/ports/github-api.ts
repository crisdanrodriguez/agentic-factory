import type { GitHubIssueEvent } from './github.js';
import type { IntakeRecord } from '../core/intake.js';

/** Read-only issue discovery is intentionally separate from GitHub writes. */
export interface GitHubIssueReader {
  listIssues(signal: AbortSignal): Promise<readonly GitHubIssueEvent[]>;
  /** Commit the read cursor only after the caller has durably processed the batch. */
  commitCursor?(): Promise<void>;
}

export interface GitHubIssuePolling {
  pollOnce(signal: AbortSignal): Promise<{ discovered: readonly GitHubIssueEvent[]; accepted: readonly IntakeRecord[]; rejected: number }>;
  /** Commit the reader cursor after downstream processing is durable. */
  commitCursor?(): Promise<void>;
}

export interface GitHubIssueWriter {
  createComment(input: { repositoryFullName: string; issueNumber: number; body: string; idempotencyKey: string }, signal: AbortSignal): Promise<void>;
}

export interface GitHubCursorStore {
  load(): Promise<string | null>;
  save(cursor: string): Promise<void>;
}
