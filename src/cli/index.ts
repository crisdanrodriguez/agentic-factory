import { validateConfigFile } from '../runtime/validate-config.js';

const help = `Agentic Factory bootstrap\n\nUsage:\n  node dist/cli/index.js --help\n  node dist/cli/index.js validate <configuration.json>\n\nValidates synthetic profile configuration against trusted bootstrap policy.\nDoes not execute commands, approve work, or connect to providers.`;

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'))) {
  console.log(help);
} else if (args.length === 2 && args[0] === 'validate' && args[1]) {
  try {
    console.log(await validateConfigFile(args[1]));
  } catch (error) {
    console.error(`Validation failed: ${error instanceof Error ? error.message : 'Unknown validation error.'}`);
    process.exitCode = 1;
  }
} else {
  console.error('Invalid arguments. Use --help for usage.');
  process.exitCode = 2;
}
