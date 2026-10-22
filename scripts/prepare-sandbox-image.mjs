import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Installation-only operation. No project request can invoke this script or select an image.
const lock = JSON.parse(readFileSync(new URL('../sandbox/images.json', import.meta.url), 'utf8'));
const socket = process.env.AF_DOCKER_SOCKET;
if (!socket?.startsWith('/') || socket.includes('\0')) throw new Error('AF_DOCKER_SOCKET must specify a local Unix socket.');
if (process.argv.slice(2).some((arg) => arg !== '--offline') || process.argv.length > 3) throw new Error('Only --offline is supported.');
const offline = process.argv.includes('--offline');
const docker = (...args) => execFileSync('docker', ['--host', `unix://${socket}`, ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
const version = JSON.parse(docker('version', '--format', '{{json .Server}}'));
const engine = version.Components.find((component) => component.Name === 'Engine')?.Version;
if (!offline && engine !== '29.9.2')
  throw new Error('Registry access refused: exact reviewed Engine 29.9.2 is required for the TLS revocation fix. No registry request was made.');
const info = JSON.parse(docker('info', '--format', '{{json .}}'));
const architecture = ({ aarch64: 'arm64', x86_64: 'amd64' })[info.Architecture];
if (!architecture || info.OSType !== 'linux') throw new Error('Unsupported runtime platform.');
const image = `${lock.repository}@${lock.index}`;
if (!offline) {
  const registry = info.RegistryConfig;
  if (!registry || registry.Mirrors?.length || Object.values(registry.IndexConfigs ?? {}).some((value) => value.Secure !== true) ||
      (registry.InsecureRegistryCIDRs ?? []).some((range) => !['127.0.0.0/8', '::1/128'].includes(range)))
    throw new Error('Registry policy rejected insecure settings or unreviewed mirrors before pull.');
}
if (!offline) {
  try { docker('pull', '--platform', `linux/${architecture}`, image); }
  catch (error) {
    // Preserve actual Docker diagnostics. Generic x509 errors do not establish revocation.
    process.stderr.write('Registry pull failed after runtime policy passed; inspect the following actual diagnostic. No TLS bypass or fallback was attempted.\n');
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}
const [metadata] = JSON.parse(docker('image', 'inspect', '--platform', `linux/${architecture}`, image));
// Diagnostic evidence only: the validation predicates below remain authoritative and unchanged.
const emit = (name, value) => console.log('IMAGE_DIAGNOSTIC ' + JSON.stringify({ name, value }));
const bounded = (value) => typeof value === 'string' ? value.slice(0, 512) : null;
const descriptor = (value) => ({ digest: bounded(value?.digest), mediaType: bounded(value?.mediaType),
  platform: { architecture: bounded(value?.platform?.architecture), os: bounded(value?.platform?.os), variant: bounded(value?.platform?.variant) } });
const summarize = (value) => ({
  Architecture: bounded(value?.Architecture), Os: bounded(value?.Os),
  Descriptor: descriptor(value?.Descriptor), Id: bounded(value?.Id),
  RepoDigests: Array.isArray(value?.RepoDigests) ? value.RepoDigests.filter((ref) => typeof ref === 'string' && ref.includes('@sha256:')).slice(0, 32).map(bounded) : [],
  RootFS: { Type: bounded(value?.RootFS?.Type), layerCount: Array.isArray(value?.RootFS?.Layers) ? value.RootFS.Layers.length : null },
  manifestsExposed: Array.isArray(value?.Manifests),
  Manifests: Array.isArray(value?.Manifests) ? value.Manifests.slice(0, 32).map((entry) => ({
    Descriptor: descriptor(entry.Descriptor), Available: typeof entry.Available === 'boolean' ? entry.Available : null,
    Kind: bounded(entry.Kind), Id: bounded(entry.ID),
  })) : [],
});
emit('expected', { index: lock.index, manifest: lock.manifests[architecture], platform: 'linux/' + architecture });
emit('selectedLocalImage', summarize(metadata));
emit('existingGateComparisons', { architecture: metadata.Architecture === architecture, os: metadata.Os === 'linux',
  descriptorEqualsManifest: metadata.Descriptor?.digest === lock.manifests[architecture] });
const diagnose = (name, args, project) => {
  try { emit(name, { available: true, evidence: project(JSON.parse(docker(...args))) }); }
  catch (error) {
    // Do not dump arbitrary command output/configuration; diagnostic failure never changes the image gate.
    emit(name, { available: false, exitStatus: Number.isInteger(error.status) ? error.status : null,
      reason: error instanceof SyntaxError ? 'Invalid JSON response' : 'Read-only inspection unavailable' });
  }
};
diagnose('localIndex', ['image', 'inspect', image], (rows) => summarize(rows[0]));
diagnose('localLockedManifest', ['image', 'inspect', '--platform', 'linux/' + architecture,
  lock.repository + '@' + lock.manifests[architecture]], (rows) => summarize(rows[0]));
if (!offline) {
  // Existing Docker CLI only, exact digest references, default verified TLS, no insecure flag.
  diagnose('registryLockedIndex', ['manifest', 'inspect', image], (value) => ({
    mediaType: bounded(value.mediaType),
    selectedPlatformDescriptors: Array.isArray(value.manifests) ? value.manifests.filter((entry) =>
      entry.platform?.architecture === architecture && entry.platform?.os === 'linux').slice(0, 32).map(descriptor) : [],
  }));
  diagnose('registryLockedManifest', ['manifest', 'inspect', lock.repository + '@' + lock.manifests[architecture]], (value) => ({
    mediaType: bounded(value.mediaType), config: descriptor(value.config),
    layerCount: Array.isArray(value.layers) ? value.layers.length : null,
    configurationEqualsLocalId: value.config?.digest === metadata.Id,
  }));
}
if (metadata.Architecture !== architecture || metadata.Os !== 'linux' || metadata.Descriptor?.digest !== lock.manifests[architecture])
  throw new Error('Pinned environment content or platform is unavailable or mismatched.');
if (!/^sha256:[a-f0-9]{64}$/.test(metadata.Id ?? '') || !metadata.RootFS?.Layers?.length || metadata.RootFS.Type !== 'layers')
  throw new Error('Resolved image configuration or layer identity is unavailable.');
console.log(`IMAGE index=${lock.index} manifest=${metadata.Descriptor.digest} configuration=${metadata.Id} platform=linux/${architecture}`);
console.log(`PASS: cached ${architecture} environment matches ${lock.manifests[architecture]}.`);
console.log(offline ? 'Offline verification only; registry TLS readiness is not established.' : 'Image preparation completed with TLS verification enabled.');
