import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyImageIdentity, verifyLocalImage } from './verify-image-identity.mjs';

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

verifyLocalImage(lock, architecture, metadata);
console.log('IMAGE_LOCAL ' + JSON.stringify({ index: lock.index, manifest: lock.manifests[architecture],
  architecture: metadata.Architecture, os: metadata.Os, configuration: metadata.Id,
  descriptor: metadata.Descriptor ? { digest: metadata.Descriptor.digest, mediaType: metadata.Descriptor.mediaType } : null, layerCount: metadata.RootFS.Layers.length }));
if (offline) throw new Error('Offline metadata is preliminary only; fresh registry-backed identity verification is required.');
const clientVersion = JSON.parse(docker('version', '--format', '{{json .Client}}')).Version;
if (clientVersion !== '29.9.2') throw new Error('Exact reviewed Docker CLI 29.9.2 is required for digest-verified retrieval.');
// Docker CLI verifies original payload digests, but checks its local manifest cache first.
// An empty private config forces registry retrieval without importing credentials or cached manifests.
const configuration = mkdtempSync(join(tmpdir(), 'af007-registry-'));
try {
  const retrieve = (reference) => JSON.parse(docker('--config', configuration, 'manifest', 'inspect', reference));
  const index = retrieve(image);
  const manifest = retrieve(lock.repository + '@' + lock.manifests[architecture]);
  verifyImageIdentity(lock, architecture, metadata, index, manifest);
  console.log('IMAGE_VERIFIED ' + JSON.stringify({ index: lock.index, manifest: lock.manifests[architecture],
    configuration: metadata.Id, platform: 'linux/' + architecture, layerCount: manifest.layers.length }));
  console.log('PASS: immutable index, selected manifest, local configuration and platform verified with TLS enabled.');
} finally {
  rmSync(configuration, { recursive: true, force: true });
}
