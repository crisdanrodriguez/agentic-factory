import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function fixture(operation) {
  const directory = mkdtempSync(join(tmpdir(), 'af007-tools-'));
  const log = join(directory, 'calls');
  const docker = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2); appendFileSync(process.env.CALLS, JSON.stringify(args)+'\\n');
const scenario = process.env.SCENARIO;
if(args.includes('version')) console.log(JSON.stringify({Components:[{Name:'Engine',Version:scenario==='old'?'29.9.1':'29.9.2'}]}));
else if(args.includes('info')) console.log(JSON.stringify({Architecture:'x86_64',OSType:'linux',RegistryConfig:{Mirrors:[],IndexConfigs:{},InsecureRegistryCIDRs:scenario==='insecure'?['0.0.0.0/0']:[]}}));
else if(args.includes('pull')) { if(scenario==='tls') {console.error('x509: certificate signed by unknown authority');process.exit(1);} }
else if(args.includes('manifest')) {
 if(scenario==='diagnostic-unavailable') process.exit(1);
 const child='sha256:08b493e9c2f92a0f84e45062338a1503d0f585d63ba8783baad5a24cdf200894';
 console.log(JSON.stringify(args.at(-1).endsWith(child)?{mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:'sha256:'+'a'.repeat(64)},layers:[{}]}:
 {mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{digest:child,mediaType:'application/vnd.oci.image.manifest.v1+json',platform:{architecture:'amd64',os:'linux'}}]}));
}
else if(args.includes('image')) console.log(JSON.stringify([{Architecture:'amd64',Os:'linux',Id:'sha256:'+'a'.repeat(64),RootFS:{Type:'layers',Layers:['sha256:'+'b'.repeat(64)]},Config:{Env:['SYNTHETIC_PRIVATE_SENTINEL']},RepoDigests:['python@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e'],Descriptor:{mediaType:'application/vnd.oci.image.index.v1+json',digest:scenario==='index-descriptor'?'sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e':scenario==='mismatch'?'sha256:'+'c'.repeat(64):'sha256:08b493e9c2f92a0f84e45062338a1503d0f585d63ba8783baad5a24cdf200894'}}]));
else if(args.includes('ps')) {if(scenario==='cleanup-failure'){console.error('daemon unavailable');process.exit(1);} }
`;
  writeFileSync(join(directory, 'docker'), docker, { mode: 0o700 });
  try { operation({ directory, log, env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CALLS: log, AF_DOCKER_SOCKET: '/synthetic.sock' } }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
for (const scenario of ['valid', 'old', 'insecure', 'tls', 'mismatch']) {
  test(`synthetic image tooling: ${scenario}`, () => fixture(({env, log}) => {
    const result = spawnSync(process.execPath, ['scripts/prepare-sandbox-image.mjs'], {env:{...env,SCENARIO:scenario},encoding:'utf8'});
    assert.equal(result.status, scenario==='valid'?0:1, result.stderr);
    const calls=readFileSync(log,'utf8');
    if (['old','insecure'].includes(scenario)) assert.doesNotMatch(calls, /"pull"/);
    if (scenario==='tls') {
      assert.match(result.stderr,/Registry pull failed after runtime policy passed/);
      assert.match(result.stderr,/unknown authority/);
      assert.doesNotMatch(result.stderr,/certificate revoked/);
    }
    if(scenario==='valid') assert.match(result.stdout,/configuration=sha256:/);
  }));
}
for (const scenario of ['cleanup-success', 'cleanup-failure']) {
  test(`synthetic cleanup tooling: ${scenario}`, () => fixture(({env}) => {
    // The script only accepts the same bounded path shape used by GitHub Actions.
    const root = `/tmp/af007-ci-${process.pid}-${scenario==='cleanup-success'?1:2}`;
    const create=spawnSync('mkdir',['-m','700',root]); assert.equal(create.status,0);
    writeFileSync(join(root,'instances'),'a'.repeat(64)+'\n');
    writeFileSync(join(root,'synthetic-socket-placeholder'),'synthetic');
    try {
      const result=spawnSync('python3',['scripts/cleanup-sandbox-ci.py'],{env:{...env,AF_SANDBOX_TEST_ROOT:root,SCENARIO:scenario},encoding:'utf8'});
      assert.equal(result.status,scenario==='cleanup-success'?0:1,result.stderr);
      assert.equal(existsSync(root),scenario==='cleanup-failure');
      if(scenario==='cleanup-failure') assert.match(result.stderr,/CLEANUP FAILURE/);
    } finally { rmSync(root,{recursive:true,force:true}); }
  }));
}
test('cleanup refuses an unscoped directory', () => {
  const result=spawnSync('python3',['scripts/cleanup-sandbox-ci.py'],{env:{...process.env,AF_SANDBOX_TEST_ROOT:'/tmp'},encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Unsafe sandbox test root/);
});
test('provisioning refuses a non-GitHub-hosted environment before installation', () => {
  const result=spawnSync('bash',['scripts/provision-sandbox-ci.sh'],{env:{...process.env,GITHUB_ACTIONS:'false'},encoding:'utf8'});
  assert.equal(result.status,1);
});

const containerdRevision = 'b7a25261e029d68978bbf290df0a62fc819b3c51';
const reviewedContainerd = `containerd containerd v2.4.2 ${containerdRevision}`;
for (const [description, output, valid] of [
  ['Docker package format', reviewedContainerd, true],
  ['upstream package format', `containerd github.com/containerd/containerd/v2 v2.4.2 ${containerdRevision}`, true],
  ['older version', reviewedContainerd.replace('v2.4.2', 'v2.4.1'), false],
  ['newer version', reviewedContainerd.replace('v2.4.2', 'v2.4.3'), false],
  ['version substring', reviewedContainerd.replace('v2.4.2', 'v2.4.20'), false],
  ['prerelease', reviewedContainerd.replace('v2.4.2', 'v2.4.2-rc.1'), false],
  ['dirty build', reviewedContainerd.replace('v2.4.2', 'v2.4.2+dirty'), false],
  ['wrong executable', reviewedContainerd.replace(/^containerd/, 'ctr'), false],
  ['wrong package', reviewedContainerd.replace('containerd containerd', 'containerd untrusted'), false],
  ['missing version prefix', reviewedContainerd.replace('v2.4.2', '2.4.2'), false],
  ['missing revision', 'containerd containerd v2.4.2', false],
  ['invalid revision', reviewedContainerd.replace(containerdRevision, 'unknown'), false],
  ['extra token', reviewedContainerd + ' extra', false],
  ['multiple lines', reviewedContainerd + '\n' + reviewedContainerd, false],
  ['empty output', '', false],
]) {
  test(`containerd version parser: ${description}`, () => {
    const result = spawnSync('python3', ['-B', '-c',
      'import sys; sys.path.insert(0, "scripts"); from sandbox_runtime_version import require_containerd_version; require_containerd_version(sys.argv[1])', output],
    { encoding: 'utf8' });
    assert.equal(result.status, valid ? 0 : 1, result.stderr);
    if (!valid) assert.match(result.stderr, /Unreviewed containerd binary version or output format/);
  });
}

for (const [component, version, goVersion, valid] of [
  ['Engine', '29.9.2', 'go1.26.10', true],
  ['containerd', '2.4.2', 'go1.27.3', true],
  ['Engine', '29.9.2', 'go1.26.9', false],
  ['containerd', '2.4.2', 'go1.27.2', false],
  ['Engine', '29.9.2', 'go1.27.3', false],
  ['containerd', '2.4.2', 'go1.26.10', false],
  ['containerd', '2.4.2', 'go1.26.9', false],
  ['containerd', '2.4.2', 'go1.27.4', false],
  ['containerd', '2.4.3', 'go1.27.3', false],
  ['Engine', '29.9.3', 'go1.26.10', false],
  ['unknown', '2.4.2', 'go1.27.3', false],
]) {
  test(`reviewed Go build: ${component} ${version} ${goVersion}`, () => {
    const result = spawnSync('python3', ['-B', '-c',
      'import sys; sys.path.insert(0, "scripts"); from sandbox_runtime_version import require_reviewed_go_build; require_reviewed_go_build(*sys.argv[1:])',
      component, version, goVersion], { encoding: 'utf8' });
    assert.equal(result.status, valid ? 0 : 1, result.stderr);
    if (!valid) assert.match(result.stderr, /Unreviewed component\/Go TLS build combination/);
  });
}
for (const [description, output, valid] of [
  ['header', '/usr/bin/containerd: go1.27.3', true],
  ['metadata', '/usr/bin/containerd: go1.27.3\n\tpath\tgithub.com/containerd/containerd/v2/cmd/containerd', true],
  ['missing', '', false],
  ['missing version', '/usr/bin/containerd:', false],
  ['wrong binary', '/tmp/containerd: go1.27.3', false],
  ['substring', '/usr/bin/containerd: go1.27.3 unexpected', false],
  ['prerelease', '/usr/bin/containerd: go1.27.3rc1', false],
  ['custom build', '/usr/bin/containerd: go1.27.3+custom', false],
  ['development build', '/usr/bin/containerd: devel go1.27.3', false],
  ['duplicate header', '/usr/bin/containerd: go1.27.3\n/usr/bin/containerd: go1.27.2', false],
]) {
  test(`embedded Go parser: ${description}`, () => {
    const result = spawnSync('python3', ['-B', '-c',
      'import sys; sys.path.insert(0, "scripts"); from sandbox_runtime_version import embedded_go_version; print(embedded_go_version(sys.argv[1], "/usr/bin/containerd"))', output],
    { encoding: 'utf8' });
    assert.equal(result.status, valid ? 0 : 1, result.stderr);
    if (valid) assert.equal(result.stdout.trim(), 'go1.27.3');
    else assert.match(result.stderr, /Missing embedded Go version|Malformed embedded Go build information/);
  });
}

// Component map captured from Docker in run 39578840617; all other identities stay fixed.
for (const representation of ['2.4.2', 'v2.4.2', 'v2.4.1', 'v2.4.3', 'v2.4.20', 'v2.4.2-rc.1',
  '2.4.2+dirty', 'v2.4.2+build', 'vv2.4.2', 'V2.4.2', ' v2.4.2', 'v2.4.2 ', 'v2.4.2\n', '', null]) {
  test(`Python API preflight containerd representation: ${JSON.stringify(representation)}`, () => {
    const components = { Engine: '29.9.2', containerd: representation, 'docker-init': '0.19.0', runc: '1.5.2' };
    const result = spawnSync('python3', ['-B', '-c',
      'import sys,json; sys.path.insert(0, "scripts"); from sandbox_runtime_version import require_api_components; require_api_components(json.loads(sys.argv[1]))',
      JSON.stringify(components)], { encoding: 'utf8' });
    assert.equal(result.status, ['2.4.2', 'v2.4.2'].includes(representation) ? 0 : 1, result.stderr);
    if (result.status !== 0) assert.match(result.stderr, /Active component mismatch: containerd/);
  });
}
for (const component of ['Engine', 'runc']) {
  test(`Python API preflight does not normalize ${component}`, () => {
    const components = { Engine: '29.9.2', containerd: 'v2.4.2', 'docker-init': '0.19.0', runc: '1.5.2' };
    components[component] = 'v' + components[component];
    const result = spawnSync('python3', ['-B', '-c',
      'import sys,json; sys.path.insert(0, "scripts"); from sandbox_runtime_version import require_api_components; require_api_components(json.loads(sys.argv[1]))',
      JSON.stringify(components)], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`Active component mismatch: ${component}`));
  });
}

for (const [description, entries, valid] of [
  ['observed default profile', ['name=apparmor,profile=default'], true],
  ['missing', [], false],
  ['malformed additional entry', ['name=apparmor,profile=default', ' name=apparmor,profile=unconfined'], false],
  ['unspecified profile', ['name=apparmor'], false],
  ['unconfined', ['name=apparmor,profile=unconfined'], false],
  ['custom template', ['name=apparmor,profile=/etc/docker/custom'], false],
  ['suffix', ['name=apparmor,profile=default,mode=complain'], false],
  ['duplicate', ['name=apparmor,profile=default', 'name=apparmor,profile=default'], false],
  ['conflicting', ['name=apparmor,profile=default', 'name=apparmor,profile=unconfined'], false],
  ['malformed', ['name=apparmor,profile=default ', null], false],
]) {
  test(`AppArmor metadata parser: ${description}`, () => {
    const options = [...entries, 'name=seccomp,profile=builtin', 'name=cgroupns'];
    const result = spawnSync('python3', ['-B', '-c',
      'import sys,json; sys.path.insert(0, "scripts"); from sandbox_runtime_version import require_default_apparmor; require_default_apparmor(json.loads(sys.argv[1]))',
      JSON.stringify(options)], { encoding: 'utf8' });
    assert.equal(result.status, valid ? 0 : 1, result.stderr);
    if (!valid) assert.match(result.stderr, /AppArmor profile is unavailable or unreviewed|Malformed Docker security options/);
  });
}

for (const [description, changes, valid] of [
  ['reviewed host', {}, true],
  ['disabled kernel', { enabled: 'N' }, false],
  ['missing LSM', { lsm: 'lockdown,capability' }, false],
  ['missing profile', { profiles: '' }, false],
  ['complain mode', { profiles: 'docker-default (complain)' }, false],
  ['duplicate profile', { profiles: 'docker-default (enforce)\ndocker-default (enforce)' }, false],
  ['conflicting profile', { profiles: 'docker-default (enforce)\ndocker-default (complain)' }, false],
  ['custom CLI template', { arguments: ['/usr/bin/dockerd', '--apparmor-profile=/tmp/custom'] }, false],
  ['split CLI template', { arguments: ['/usr/bin/dockerd', '--apparmor-profile', '/tmp/custom'] }, false],
  ['alternate config', { arguments: ['/usr/bin/dockerd', '--config-file=/tmp/custom.json'] }, false],
  ['custom JSON template', { configuration: { 'apparmor-profile': '/tmp/custom' } }, false],
]) {
  test(`AppArmor host evidence: ${description}`, () => {
    const evidence = { enabled: 'Y\n', lsm: 'lockdown,capability,apparmor', profiles: 'docker-default (enforce)\n',
      arguments: ['/usr/bin/dockerd', '-H', 'fd://'], configuration: {}, ...changes };
    const result = spawnSync('python3', ['-B', '-c',
      'import sys,json; sys.path.insert(0,"scripts"); from sandbox_runtime_version import require_host_apparmor; require_host_apparmor(**json.loads(sys.argv[1]))',
      JSON.stringify(evidence)], { encoding: 'utf8' });
    assert.equal(result.status, valid ? 0 : 1, result.stderr);
  });
}


for (const scenario of ['valid', 'index-descriptor', 'diagnostic-unavailable']) {
  test(`image identity diagnostics preserve the existing gate: ${scenario}`, () => fixture(({ env, log }) => {
    const result = spawnSync(process.execPath, ['scripts/prepare-sandbox-image.mjs'], {
      env: { ...env, SCENARIO: scenario }, encoding: 'utf8' });
    assert.equal(result.status, scenario === 'index-descriptor' ? 1 : 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_SENTINEL/);
    const evidence = Object.fromEntries(result.stdout.split('\n').filter((line) => line.startsWith('IMAGE_DIAGNOSTIC '))
      .map((line) => { const row = JSON.parse(line.slice('IMAGE_DIAGNOSTIC '.length)); return [row.name, row.value]; }));
    assert.equal(evidence.selectedLocalImage.Architecture, 'amd64');
    assert.equal(evidence.selectedLocalImage.RootFS.layerCount, 1);
    assert.equal(evidence.existingGateComparisons.descriptorEqualsManifest, scenario !== 'index-descriptor');
    assert.equal(evidence.registryLockedManifest.available, scenario !== 'diagnostic-unavailable');
    if (scenario !== 'diagnostic-unavailable') {
      assert.equal(evidence.registryLockedManifest.evidence.configurationEqualsLocalId, true);
      assert.equal(evidence.registryLockedIndex.evidence.selectedPlatformDescriptors[0].digest, evidence.expected.manifest);
    }
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    for (const args of calls.filter((args) => args.includes('manifest'))) {
      assert.match(args.at(-1), /^python@sha256:[a-f0-9]{64}$/);
      assert.ok(!args.includes('--insecure'));
    }
    assert.ok(!calls.some((args) => args.includes('run') || args.includes('create')));
  }));
}
test('offline image identity diagnostics do not contact the registry', () => fixture(({ env, log }) => {
  const result = spawnSync(process.execPath, ['scripts/prepare-sandbox-image.mjs', '--offline'], {
    env: { ...env, SCENARIO: 'valid' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.doesNotMatch(calls, /"manifest"|"pull"/);
}));
