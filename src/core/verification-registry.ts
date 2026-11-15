import type { ProjectConfiguration } from './configuration.js';
import type { ProjectProfile } from './contracts.js';

type CheckDefinition = Readonly<{
  profile: ProjectProfile['id'];
  layer: ProjectProfile['checks'][number]['layer'];
  argv: readonly string[];
  environment: Readonly<ProjectProfile['environment']>;
}>;

const TRUSTED_ENVIRONMENT = Object.freeze({ language: 'python', version: '3.12', fingerprint: 'synthetic-python-environment-1' });

/** Reviewed synthetic commands. New project environments require separate owner review. */
const TRUSTED_CHECKS: Readonly<Record<string, CheckDefinition>> = Object.freeze({
  'software-general:software-tests': { profile: 'software-general', layer: 'software', argv: ['python', '-m', 'unittest'], environment: TRUSTED_ENVIRONMENT },
  'ml-research:software-tests': { profile: 'ml-research', layer: 'software', argv: ['python', '-m', 'unittest'], environment: TRUSTED_ENVIRONMENT },
  'ml-research:methodology-review': { profile: 'ml-research', layer: 'methodology', argv: ['python', 'verify_protocol.py'], environment: TRUSTED_ENVIRONMENT },
  'ml-research:findings-review': { profile: 'ml-research', layer: 'findings', argv: ['python', 'verify_report.py'], environment: TRUSTED_ENVIRONMENT },
});

/** Return only trusted argv and environment; the model-supplied command is never execution authority. */
export function resolveTrustedVerificationCheck(config: ProjectConfiguration, checkId: string): Readonly<{ argv: readonly string[]; environment: Readonly<ProjectProfile['environment']> }> {
  const check = config.profile.checks.find((entry) => entry.id === checkId);
  const trusted = TRUSTED_CHECKS[`${config.profile.id}:${checkId}`];
  if (!check || !trusted || !check.required || check.layer !== trusted.layer ||
      config.profile.environment.language !== trusted.environment.language ||
      config.profile.environment.version !== trusted.environment.version ||
      config.profile.environment.fingerprint !== trusted.environment.fingerprint ||
      check.command.length !== trusted.argv.length ||
      check.command.some((part, index) => part !== trusted.argv[index])) {
    throw new Error('Verification check is not in the trusted command registry.');
  }
  return { argv: [...trusted.argv], environment: { ...trusted.environment } };
}

export function assertTrustedVerificationChecks(config: ProjectConfiguration): void {
  for (const check of config.profile.checks) resolveTrustedVerificationCheck(config, check.id);
}
