// Parsed evidence from digest-verified Docker CLI retrieval; never hash reformatted JSON.
const digest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const indexType = 'application/vnd.oci.image.index.v1+json';
const manifestType = 'application/vnd.oci.image.manifest.v1+json';
const configType = 'application/vnd.oci.image.config.v1+json';
const requireEvidence = (condition, message) => { if (!condition) throw new Error('Image identity rejected: ' + message); };
const descriptor = (value) => value && digest(value.digest) && Number.isSafeInteger(value.size) && value.size > 0;

export function verifyLocalImage(lock, architecture, local) {
  requireEvidence(['amd64', 'arm64'].includes(architecture) && digest(lock.index) && digest(lock.manifests[architecture]), 'unreviewed platform or lock');
  requireEvidence(local?.Architecture === architecture && local.Os === 'linux', 'local platform');
  requireEvidence(Array.isArray(local.RepoDigests) && local.RepoDigests.every((ref) => typeof ref === 'string') &&
    local.RepoDigests.includes(lock.repository + '@' + lock.index), 'locked repository/index reference');
  requireEvidence(digest(local.Id), 'local configuration digest');
  requireEvidence(local.RootFS?.Type === 'layers' && Array.isArray(local.RootFS.Layers) &&
    local.RootFS.Layers.length > 0 && local.RootFS.Layers.every(digest), 'local layer availability');
  if (local.Descriptor !== undefined && local.Descriptor !== null) {
    const value = local.Descriptor;
    requireEvidence((value.digest === lock.index && value.mediaType === indexType) ||
      (value.digest === lock.manifests[architecture] && value.mediaType === manifestType), 'conflicting optional descriptor');
  }
}

export function verifyImageIdentity(lock, architecture, local, index, manifest) {
  verifyLocalImage(lock, architecture, local);
  requireEvidence(index?.schemaVersion === 2 && index.mediaType === indexType && Array.isArray(index.manifests) &&
    index.manifests.length > 0 && index.manifests.every((entry) => descriptor(entry) && entry.mediaType === manifestType &&
      typeof entry.platform?.os === 'string' && typeof entry.platform?.architecture === 'string'), 'OCI index schema');
  const selected = index.manifests.filter((entry) => entry.platform.os === 'linux' && entry.platform.architecture === architecture);
  requireEvidence(selected.length === 1 && selected[0].digest === lock.manifests[architecture], 'unique locked platform manifest');
  requireEvidence(selected[0].platform.variant === undefined ||
    (architecture === 'arm64' && selected[0].platform.variant === 'v8'), 'unreviewed platform variant');
  requireEvidence(manifest?.schemaVersion === 2 && manifest.mediaType === manifestType, 'OCI manifest schema');
  requireEvidence(descriptor(manifest.config) && manifest.config.mediaType === configType &&
    manifest.config.digest === local.Id, 'manifest/local configuration relationship');
  requireEvidence(Array.isArray(manifest.layers) && manifest.layers.length === local.RootFS.Layers.length &&
    manifest.layers.every((entry) => descriptor(entry) && [
      'application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip',
      'application/vnd.oci.image.layer.v1.tar+zstd',
    ].includes(entry.mediaType)), 'manifest/local layer availability');
  // Registry compressed layer digests and local RootFS diff IDs are different identities.
}
