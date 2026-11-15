import type { ProjectConfiguration } from './configuration.js';
import type { ProjectProfile } from './contracts.js';
import type { OwnerProjectAuthorization } from './project-authorization.js';

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
export function resolveTrustedVerificationCheck(config: ProjectConfiguration, checkId: string,
  authorization?: OwnerProjectAuthorization): Readonly<{ argv: readonly string[]; environment: Readonly<ProjectProfile['environment']>;
    workingDirectory: string; environmentVariables: Readonly<Record<string, string>> }> {
  const check = config.profile.checks.find((entry) => entry.id === checkId);
  const projectCheck = authorization?.checks.find((entry) => entry.id === checkId);
  const trusted = authorization ? (projectCheck && { profile: authorization.profileId, layer: projectCheck.layer,
    argv: projectCheck.argv, environment: authorization.environment }) : TRUSTED_CHECKS[`${config.profile.id}:${checkId}`];
  if (!check || !trusted || !check.required || config.profile.id !== trusted.profile || check.layer !== trusted.layer ||
      config.profile.environment.language !== trusted.environment.language ||
      config.profile.environment.version !== trusted.environment.version ||
      config.profile.environment.fingerprint !== trusted.environment.fingerprint ||
      check.command.length !== trusted.argv.length ||
      check.command.some((part, index) => part !== trusted.argv[index])) {
    throw new Error('Verification check is not in the trusted command registry.');
  }
  const environmentVariables: Record<string, string> = {};
  for (const [key, value] of Object.entries(projectCheck?.environmentVariables ?? {})) {
    if (value !== undefined) environmentVariables[key] = value;
  }
  return { argv: [...trusted.argv], environment: { ...trusted.environment },
    workingDirectory: projectCheck?.workingDirectory ?? '.', environmentVariables };
}

export function assertTrustedVerificationChecks(config: ProjectConfiguration, authorization?: OwnerProjectAuthorization): void {
  for (const check of config.profile.checks) resolveTrustedVerificationCheck(config, check.id, authorization);
}
