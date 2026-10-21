import { WorkflowQueue, SingleWorker } from '../adapters/pg-boss-queue.js';
import { PostgresWorkflowStore } from '../adapters/postgres/workflow-store.js';
import { SyntheticAgent, SyntheticJobs, SYNTHETIC_FINDING } from '../adapters/synthetic/execution.js';
import { evidenceContext, type Command, type Run, type Scope } from '../core/workflow.js';

export interface SimulationScenario {
  technicalFailures?: number;
  neverCompletes?: boolean;
  missingArtifacts?: boolean;
  missingVerification?: boolean;
}
export const operationKey = (run: Run): string => `synthetic-${run.id}-${run.config.plan.revision}-${run.step.generation - (run.cancellationRequested ? 1 : 0)}`;

/** Test-only composition. All proposals, job outcomes, artifacts and evidence are synthetic. */
export class SyntheticFactory {
  readonly queue: WorkflowQueue;
  readonly store: PostgresWorkflowStore;
  readonly worker: SingleWorker;
  readonly jobs: SyntheticJobs;
  readonly agent = new SyntheticAgent();
  constructor(url: string, directory: string, now: () => number, private readonly scope: Scope, private readonly scenario: SimulationScenario = {}) {
    this.queue = new WorkflowQueue(url);
    this.store = new PostgresWorkflowStore(url, (client, scope, run) => this.queue.publish(client, scope, run));
    this.worker = new SingleWorker(this.store, this.queue);
    this.jobs = new SyntheticJobs(directory, now, (context) => this.store.authorizeJob(this.scope, context), scenario.neverCompletes);
  }
  async start(): Promise<void> { await this.queue.start(); await this.worker.start(); }
  async close(): Promise<void> { await this.worker.close(); await this.queue.close(); await this.store.close(); }
  async tick(): Promise<boolean> {
    return this.worker.once(async (wake, client) => {
      const scope = wake.data.scope;
      if (scope.organizationId !== this.scope.organizationId || scope.projectId !== this.scope.projectId) throw new Error('Wake is outside the configured simulation scope.');
      let run = await this.store.getForUpdate(client, scope, wake.data.runId);
      const context = evidenceContext(run);
      const apply = async (command: Command): Promise<void> => {
        run = await this.store.applyInTransaction(client, scope, run.id, run.version, `synthetic-${run.version}-${command.type}`, command);
      };
      if (run.cancellationRequested) {
        if (run.job) await this.jobs.cancel(run.job.id, context);
        else await this.jobs.cancelIfSubmitted(context, operationKey(run));
        await apply({ type: 'confirm-cancellation' }); return;
      }
      switch (run.phase) {
        case 'ready': await apply({ type: 'start' }); break;
        case 'running': {
          await this.agent.propose({ context, instruction: 'Synthetic proposal only; execute no commands.', authorizedWorkspace: 'synthetic-private-workspace' }, new AbortController().signal);
          if (run.step.attempts <= (this.scenario.technicalFailures ?? 0)) {
            await apply({ type: 'technical-failure', generation: run.step.generation }); break;
          }
          const key = operationKey(run);
          const { jobId } = await this.jobs.start({ context, idempotencyKey: key, command: ['synthetic-no-execution'],
            authorizedEnvironment: run.config.profile.environment.fingerprint,
            maxDurationSeconds: run.config.plan.budget.maxDurationSeconds, maxMemoryMb: run.config.plan.budget.maxMemoryMb });
          await apply({ type: 'job-started', jobId, operationKey: key }); break;
        }
        case 'awaiting-job': {
          if (!run.job) throw new Error('Persisted job identity is required for reconciliation.');
          const job = await this.jobs.inspect(run.job.id, context);
          if (job.status === 'running') { await this.queue.defer(client, scope, run); break; }
          if (job.status !== 'completed') { await apply({ type: 'technical-failure', generation: run.step.generation }); break; }
          const artifactReferences = this.scenario.missingArtifacts ? [] : run.config.profile.deliverables.map((kind) => `${kind}:synthetic-${kind}-${run.id}`);
          await apply({ type: 'job-completed', jobId: run.job.id, artifactReferences }); break;
        }
        case 'verifying': {
          const results = this.scenario.missingVerification ? [] : run.config.profile.checks.map((check) => ({
            checkId: check.id, status: 'passed' as const, context, evidenceReferences: [`synthetic-evidence-${check.id}-${run.id}`],
          }));
          await apply({ type: 'verify', results });
          // These fixed fixture values model an unfavorable outcome, not measured science.
          const unmetPerformance = run.config.profile.id === 'ml-research' && run.config.plan.objectiveKind === 'performance' && !SYNTHETIC_FINDING.improved;
          await apply({ type: 'assess', assessment: unmetPerformance ? 'unmet' : 'met' }); break;
        }
        case 'awaiting-approval': case 'review': case 'terminal': break;
      }
    });
  }
}
