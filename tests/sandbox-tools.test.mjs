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
else if(args.includes('image')) console.log(JSON.stringify([{Architecture:'amd64',Os:'linux',Id:'sha256:'+'a'.repeat(64),RootFS:{Type:'layers',Layers:['sha256:'+'b'.repeat(64)]},Descriptor:{digest:scenario==='mismatch'?'sha256:'+'c'.repeat(64):'sha256:08b493e9c2f92a0f84e45062338a1503d0f585d63ba8783baad5a24cdf200894'}}]));
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
