import { validateConfigFile } from '../runtime/validate-config.js';

const help = `Agentic Factory bootstrap\n\nUsage:\n  node dist/cli/index.js --help\n  node dist/cli/index.js validate <configuration.json>\n  node dist/cli/index.js work-item <create|revise|show> --project <alias> [options]\n  node dist/cli/index.js github-mvp <discover|synchronize|publish-plan|feedback> ...\n  See docs/LOCAL_INTAKE.md and docs/MVP01_LIVE_ACCEPTANCE.md for trusted configuration.\n\nValidates synthetic profile configuration against trusted bootstrap policy.\nDoes not execute commands, approve work, or connect to providers unless the explicit github-mvp command is configured and authorized.`;

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
  console.log(help);
} else if (args.length === 2 && args[0] === 'validate' && args[1]) {
  try { console.log(await validateConfigFile(args[1])); }
  catch (error) { console.error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown validation error.'}`); process.exitCode = 1; }
} else if (args[0] === 'work-item') {
  try { const { runIntake } = await import('../runtime/intake.js'); console.log(await runIntake(args.slice(1))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Intake operation failed.'); process.exitCode = 1; }
} else if (args[0] === 'github-mvp') {
  try {
    const { createGitHubMvpRuntime, readGitHubMvpConfig } = await import('../runtime/github-mvp.js');
    const configPath = process.env.FACTORY_GITHUB_MVP_CONFIG; if (!configPath) throw new Error('FACTORY_GITHUB_MVP_CONFIG is required.');
    const runtime = await createGitHubMvpRuntime(await readGitHubMvpConfig(configPath));
    try {
      const operation = args[1];
      if (operation === 'discover' && args.length === 2) {
        const events = await runtime.discover(new AbortController().signal);
        console.log(JSON.stringify({ status: 'discovered', issues: events.map((event) => ({ issueNumber: event.issueNumber, action: event.action, updatedAt: event.updatedAt })) }));
      } else if (operation === 'synchronize' && args.length === 2) {
        const checkpoints = await runtime.synchronize(new AbortController().signal);
        console.log(JSON.stringify({ status: 'synchronized', plans: checkpoints.map((checkpoint) => ({ reference: checkpoint.reference, workItemRevision: checkpoint.workItem.revision, planRevision: checkpoint.plan.plan.revision, approval: checkpoint.approval })) }));
      } else if (operation === 'publish-plan' && args.length === 3 && args[2]) {
        await runtime.publishPlan(args[2], new AbortController().signal); console.log(JSON.stringify({ status: 'comment-published' }));
      } else if (operation === 'feedback' && args.length === 3 && /^\d+$/.test(args[2]!)) {
        const applied = await runtime.applyOwnerFeedback(Number(args[2]), new AbortController().signal); console.log(JSON.stringify({ status: 'feedback-processed', applied }));
      } else throw new Error('Invalid github-mvp operation.');
    } finally { await runtime.close(); }
  } catch (error) { console.error(error instanceof Error ? error.message : 'GitHub MVP operation failed.'); process.exitCode = 1; }
} else {
  console.error('Invalid arguments. Use --help for usage.'); process.exitCode = 2;
}
