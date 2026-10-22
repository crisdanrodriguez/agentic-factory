import { cliSource, fail, IntakeError, validIdentifier } from '../core/intake.js';
import { fileSource, readInstallation } from '../adapters/local-intake.js';
import { PostgresWorkItemStore } from '../adapters/postgres/work-item-store.js';

export async function runIntake(args: string[]): Promise<string> {
  let store: PostgresWorkItemStore | undefined;
  try {
    const [operation, ...tokens] = args;
    if (!operation || !['create', 'revise', 'show'].includes(operation) || tokens.length % 2 !== 0) fail('Invalid work-item arguments.');
    const values = new Map<string, string>();
    const allowed = operation === 'show' ? ['--project', '--id', '--revision'] :
      ['--project', '--key', '--file', '--objective', '--context', ...(operation === 'revise' ? ['--id', '--expected-revision'] : [])];
    for (let index = 0; index < tokens.length; index += 2) {
      const name = tokens[index]!; const value = tokens[index + 1]!;
      if (!allowed.includes(name) || values.has(name)) fail('Unknown or duplicate work-item option.');
      values.set(name, value);
    }
    const required = (name: string): string => values.get(name) ?? fail('Missing required work-item option.');
    const alias = validIdentifier(required('--project'));
    const installation = await readInstallation(process.env.FACTORY_INTAKE_CONFIG ?? '');
    if (!Object.hasOwn(installation.projects, alias)) fail('Project is not configured for local intake.');
    const scope = installation.projects[alias]!;
    const url = process.env[installation.databaseUrlEnvironment];
    if (!url) fail('Intake database configuration is unavailable.');
    const id = operation !== 'create' ? validIdentifier(required('--id')) : undefined;
    if (operation === 'show') {
      store = new PostgresWorkItemStore(url);
      return JSON.stringify(await store.get(scope, id!, values.get('--revision')));
    }
    const key = validIdentifier(required('--key'));
    const filename = values.get('--file');
    if (filename !== undefined && (values.has('--objective') || values.has('--context'))) fail('Choose file input or explicit request fields.');
    const source = filename !== undefined ? await fileSource(scope.inbox, filename) : cliSource(required('--objective'), required('--context'));
    store = new PostgresWorkItemStore(url);
    const result = await store.ingest(scope, operation === 'create' ? { kind: 'create', key } :
      { kind: 'revise', key, id: id!, expectedRevision: required('--expected-revision') }, source);
    // Creation/revision receipts intentionally omit potentially sensitive request bodies.
    return JSON.stringify({ status: 'recorded', id: result.workItem.id, revision: result.workItem.revision, digest: result.digest });
  } catch (error) {
    throw new IntakeError(error instanceof IntakeError ? error.message : 'Intake operation failed; verify trusted configuration, database availability, and permissions.');
  } finally { await store?.close(); }
}
