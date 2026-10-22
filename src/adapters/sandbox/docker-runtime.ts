import { z } from 'zod';
import { DockerApi, DockerError } from './docker-api.js';
import { collectWorkspace, prepareWorkspace } from './container-helper.js';
import type { Grant } from './policy.js';

// This trusted wrapper checks the exec process before replacing itself with the project command.
export const confinedExecution = `import os,pathlib,sys
if pathlib.Path('/proc/self/attr/current').read_text().strip() != 'docker-default (enforce)':
 raise RuntimeError('Required AppArmor process confinement is unavailable')
os.execvp(sys.argv[1], sys.argv[1:])
`;
const idSchema = z.object({ Id: z.string().regex(/^[a-f0-9]{64}$/) });
const executionSchema = z.object({ Running: z.boolean(), ExitCode: z.number().int().nullable() });
export const containerSchema = z.object({ Id: z.string(), AppArmorProfile: z.string().optional(), Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }),
  State: z.object({ Running: z.boolean(), Paused: z.boolean(), OOMKilled: z.boolean() }) });
export class DockerRuntime {
  constructor(readonly api: DockerApi, readonly instance: string) {}
  async create(name: string, grant: Grant, image: string, digest: string): Promise<void> {
    if (!/^python@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Only a pinned trusted Python environment is supported.');
    await this.api.call('POST', `/containers/create?name=${encodeURIComponent(name)}`, {
      Image: image, User: '65533:65533', WorkingDir: '/', Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE=1'],
      Cmd: ['python', '-c', 'import time; time.sleep(3600)'],
      Labels: { 'af.instance': this.instance, 'af.job': name, 'af.digest': digest },
      HostConfig: { Runtime: 'runc', NetworkMode: 'none', ReadonlyRootfs: true, Init: true, CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true', 'apparmor=docker-default'], NanoCpus: Math.floor(grant.limits.cpu * 1e9),
        Memory: grant.limits.memoryMb * 1024 * 1024, MemorySwap: grant.limits.memoryMb * 1024 * 1024,
        PidsLimit: grant.limits.pids, ShmSize: 1024 * 1024, LogConfig: { Type: 'none', Config: {} },
        Ulimits: [{ Name: 'nofile', Soft: 64, Hard: 64 }],
        Tmpfs: { '/workspace': `rw,nosuid,nodev,size=${grant.limits.workspaceBytes},nr_inodes=256,mode=0700,uid=65534,gid=65534`,
          '/tmp': 'rw,noexec,nosuid,nodev,size=1048576,nr_inodes=128,mode=1777' },
      },
    });
  }
  async container(name: string): Promise<z.infer<typeof containerSchema> | undefined> {
    try { return containerSchema.parse(await this.api.json('GET', `/containers/${name}/json`)); }
    catch (error) { if (error instanceof DockerError && error.status === 404) return undefined; throw error; }
  }
  async startContainer(name: string): Promise<void> { await this.api.call('POST', `/containers/${name}/start`); }
  async createExecution(name: string, command: readonly string[], capture = false): Promise<string> {
    if ((await this.container(name))?.AppArmorProfile !== 'docker-default')
      throw new Error('Required container AppArmor profile is unavailable.');
    return idSchema.parse(await this.api.json('POST', `/containers/${name}/exec`, {
      User: '65534:65534', WorkingDir: '/workspace', Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE=1'],
      Cmd: ['python', '-I', '-c', confinedExecution, ...command], AttachStdout: capture, AttachStderr: capture, AttachStdin: false, Tty: false, Privileged: false,
    })).Id;
  }
  async startExecution(id: string): Promise<void> { await this.api.call('POST', `/exec/${id}/start`, { Detach: true, Tty: false }); }
  async execution(id: string): Promise<z.infer<typeof executionSchema>> { return executionSchema.parse(await this.api.json('GET', `/exec/${id}/json`)); }
  private async helper(name: string, command: string[]): Promise<string> {
    const id = await this.createExecution(name, ['python', '-I', ...command.slice(1)], true);
    const response = await this.api.call('POST', `/exec/${id}/start`, { Detach: false, Tty: false });
    const exit = await this.execution(id);
    if (exit.Running || exit.ExitCode !== 0) throw new Error('Sandbox helper failed.');
    const output: Buffer[] = [];
    for (let offset = 0; offset < response.length;) {
      if (response.length - offset < 8) throw new Error('Truncated Docker stream.');
      const size = response.readUInt32BE(offset + 4);
      if (offset + 8 + size > response.length || response[offset] !== 1) throw new Error('Unexpected Docker helper stream.');
      output.push(response.subarray(offset + 8, offset + 8 + size)); offset += 8 + size;
    }
    return Buffer.concat(output).toString('utf8');
  }
  async prepare(name: string, grant: Grant): Promise<void> {
    const verify = `import os,pathlib,socket,sys
p=pathlib.Path
assert os.getuid()==65534
assert p('/proc/self/attr/current').read_text().strip()=='docker-default (enforce)'
s=p('/proc/self/status').read_text()
fields=dict(line.split(':',1) for line in s.splitlines() if ':' in line)
assert fields['NoNewPrivs'].strip()=='1' and fields['Seccomp'].strip()=='2'
assert int(fields['CapEff'].strip(),16)==0
assert p('/sys/fs/cgroup/memory.max').read_text().strip()==sys.argv[1]
assert p('/sys/fs/cgroup/memory.swap.max').read_text().strip()=='0'
assert p('/sys/fs/cgroup/pids.max').read_text().strip()==sys.argv[2]
q,period=map(int,p('/sys/fs/cgroup/cpu.max').read_text().split()); assert abs(q/period-float(sys.argv[3]))<0.00001
assert len(p('/proc/net/route').read_text().splitlines())==1
for _,interface in socket.if_nameindex():
 if interface!='lo': assert int(p('/sys/class/net/'+interface+'/flags').read_text(),16)&1==0
assert not p('/var/run/docker.sock').exists()
assert os.statvfs('/').f_flag&os.ST_RDONLY
v=os.statvfs('/workspace'); assert v.f_blocks*v.f_frsize<=int(sys.argv[4])
`;
    await this.helper(name, ['python', '-c', verify, String(grant.limits.memoryMb * 1024 * 1024), String(grant.limits.pids), String(grant.limits.cpu), String(grant.limits.workspaceBytes)]);
    await this.helper(name, ['python', '-c', prepareWorkspace, JSON.stringify(grant.files)]);
  }
  async collect(name: string, grant: Grant): Promise<{ path: string; base64: string }[]> {
    const data = JSON.parse(await this.helper(name, ['python', '-c', collectWorkspace, JSON.stringify(grant.outputs), String(grant.limits.outputBytes)])) as unknown;
    const outputs = z.array(z.strictObject({ path: z.string(), base64: z.string() })).max(16).parse(data);
    if (JSON.stringify(outputs.map((o) => o.path)) !== JSON.stringify(grant.outputs) || outputs.reduce((n, o) => n + Buffer.from(o.base64, 'base64').length, 0) > grant.limits.outputBytes)
      throw new Error('Invalid bounded output response.');
    return outputs;
  }
  async remove(name: string): Promise<void> {
    try { await this.api.call('DELETE', `/containers/${name}?force=true&v=true`); }
    catch (error) { if (!(error instanceof DockerError && error.status === 404)) throw error; }
    if (await this.container(name)) throw new Error('Container cleanup remains pending.');
  }
  async ownedNames(): Promise<string[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [`af.instance=${this.instance}`] }));
    const rows = z.array(z.object({ Labels: z.record(z.string(), z.string()) })).parse(await this.api.json('GET', `/containers/json?all=true&filters=${filters}`));
    return rows.map((row) => row.Labels['af.job'] ?? '');
  }
}
