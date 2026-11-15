/** Fixed codes are the only refinement error text permitted in durable state or CLI output. */
export type RefinementDiagnosticCode =
  | 'REFINEMENT_CLI_AUTH_UNAVAILABLE'
  | 'REFINEMENT_CLI_CONFIG_INVALID'
  | 'REFINEMENT_CLI_MODEL_UNAVAILABLE'
  | 'REFINEMENT_CLI_SCHEMA_REJECTED'
  | 'REFINEMENT_CLI_EXIT_NONZERO'
  | 'REFINEMENT_CLI_START_FAILED'
  | 'REFINEMENT_CLI_UNREVIEWED'
  | 'REFINEMENT_CLI_TIMEOUT'
  | 'REFINEMENT_CLI_INTERRUPTED'
  | 'REFINEMENT_CLI_OUTPUT_MISSING'
  | 'REFINEMENT_CLI_OUTPUT_UNREADABLE'
  | 'REFINEMENT_CLI_OUTPUT_OVERSIZE'
  | 'REFINEMENT_CLI_STDERR_LIMIT'
  | 'REFINEMENT_OUTPUT_MALFORMED_JSON'
  | 'REFINEMENT_OUTPUT_SCHEMA_INVALID'
  | 'REFINEMENT_OUTPUT_POLICY_REJECTED'
  | 'REFINEMENT_WORK_ITEM_MISMATCH'
  | 'REFINEMENT_SOURCE_SNAPSHOT_MISMATCH'
  | 'REFINEMENT_PERSISTENCE_FAILED'
  | 'REFINEMENT_TEMP_CLEANUP_FAILED'
  | 'REFINEMENT_OPERATION_UNKNOWN';

export class RefinementDiagnosticError extends Error {
  constructor(readonly code: RefinementDiagnosticCode, readonly retryable: boolean) {
    super(code);
    this.name = 'RefinementDiagnosticError';
  }
}

export function configurationFailure(error: unknown): RefinementDiagnosticError {
  const structural = error instanceof Error && error.message.startsWith('Invalid configuration structure');
  return new RefinementDiagnosticError(
    structural ? 'REFINEMENT_OUTPUT_SCHEMA_INVALID' : 'REFINEMENT_OUTPUT_POLICY_REJECTED', false,
  );
}

export function diagnosticFailure(error: unknown): RefinementDiagnosticError {
  return error instanceof RefinementDiagnosticError
    ? error : new RefinementDiagnosticError('REFINEMENT_OPERATION_UNKNOWN', true);
}
