import { readJsonConfiguration } from '../adapters/json-config.js';
import { validateConfiguration } from '../core/configuration.js';
import { BOOTSTRAP_CONTRACT_CATALOG, BOOTSTRAP_POLICY } from '../core/policy.js';

export async function validateConfigFile(path: string): Promise<string> {
  const config = validateConfiguration(await readJsonConfiguration(path), BOOTSTRAP_POLICY, BOOTSTRAP_CONTRACT_CATALOG);
  return `Valid configuration: ${config.profile.id}.\nContract validation only; no work executed or providers verified.`;
}
