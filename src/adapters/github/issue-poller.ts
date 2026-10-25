import type { IntakeRecord } from '../../core/intake.js';
import { GitHubIntakeError, GitHubIssueIntake } from '../../core/github-intake.js';
import type { GitHubIssueEvent } from '../../ports/github.js';
import type { GitHubIssuePolling, GitHubIssueReader } from '../../ports/github-api.js';

export type PollResult = { discovered: readonly GitHubIssueEvent[]; accepted: readonly IntakeRecord[]; rejected: number };

/** A bounded, single-repository poll pass. It never writes to GitHub. */
export class GitHubIssuePoller implements GitHubIssuePolling {
  constructor(private readonly reader: GitHubIssueReader, private readonly intake: GitHubIssueIntake) {}

  async discover(signal: AbortSignal): Promise<readonly GitHubIssueEvent[]> {
    return this.reader.listIssues(signal);
  }

  async process(events: readonly GitHubIssueEvent[]): Promise<PollResult> {
    const accepted: IntakeRecord[] = [];
    let rejected = 0;
    for (const event of events) {
      try { accepted.push(await this.intake.ingest(event)); }
      catch (error) {
        if (error instanceof GitHubIntakeError) { rejected++; continue; }
        throw error;
      }
    }
    return { discovered: events, accepted, rejected };
  }

  async pollOnce(signal: AbortSignal): Promise<PollResult> {
    const events = await this.discover(signal);
    const result = await this.process(events);
    await this.reader.commitCursor?.();
    return result;
  }
}
