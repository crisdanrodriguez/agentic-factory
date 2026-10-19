import type { ArtifactReference, EvidenceContext } from '../core/contracts.js';

export interface ArtifactStore {
  put(request: { context: EvidenceContext; kind: ArtifactReference['kind']; content: Uint8Array; maxBytes: number }): Promise<ArtifactReference>;
  get(reference: ArtifactReference, authorizedContext: EvidenceContext): Promise<Uint8Array>;
}
