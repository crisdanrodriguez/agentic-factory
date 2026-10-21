import subprocess as sp, json, uuid, time, pathlib, tempfile, socket, threading, secrets, hmac, os, errno
IMAGE=os.environ.get('AF_SANDBOX_IMAGE', '')
if not IMAGE.startswith('python@sha256:') or len(IMAGE.split(':')[-1]) != 64:
    raise RuntimeError('AF_SANDBOX_IMAGE must identify a reviewed digest; tests cannot be skipped')
docker_socket=os.environ.get('AF_DOCKER_SOCKET', '')
if not docker_socket.startswith('/'):
    raise RuntimeError('AF_DOCKER_SOCKET must be an explicit local Unix socket')
os.environ['DOCKER_HOST']='unix://'+docker_socket
os.environ.pop('DOCKER_CONTEXT', None)
PREFIX='af007-probe-'+uuid.uuid4().hex[:10]
if os.environ.get('AF_SANDBOX_TEST_ROOT'):
    with open(pathlib.Path(os.environ['AF_SANDBOX_TEST_ROOT'])/'checkpoints', 'a') as registry:
        registry.write(PREFIX+'\n')
created=[]
passed=[]
def docker(*args,check=True):
    p=sp.run(['docker',*args],capture_output=True,text=True,timeout=25)
    if check and p.returncode: raise RuntimeError(str(args)+': '+p.stderr)
    return p

def ok(name):
    passed.append(name); print('PASS '+name,flush=True)

def start(code):
    name=PREFIX+'-'+str(len(created)); created.append(name)
    args=['run','-d','--pull=never','--name',name,'--label','af007.checkpoint='+PREFIX,
      '--runtime=runc','--init','--network=none','--read-only','--user=65534:65534',
      '--cap-drop=ALL','--security-opt=apparmor=docker-default','--security-opt=no-new-privileges=true','--cpus=0.25',
      '--memory=96m','--memory-swap=96m','--pids-limit=24','--ulimit','nofile=64:64',
      '--log-driver=none','--shm-size=1m','--tmpfs','/workspace:rw,nosuid,nodev,size=4194304,nr_inodes=128,mode=0700,uid=65534,gid=65534',
      '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=1048576,nr_inodes=128,mode=1777',
      IMAGE,'python','-u','-c',code]
    docker(*args)
    assert json.loads(docker('inspect',name).stdout)[0]['AppArmorProfile']=='docker-default'
    return name

def execute(name,code):
    return docker('exec',name,'python','-c',code).stdout.strip()

try:
    c=start('import time; time.sleep(120)')
    result=execute(c,'''import os,socket,pathlib,json,errno
p=pathlib.Path
assert os.getuid()==65534
assert p('/proc/self/attr/current').read_text().strip()=='docker-default (enforce)'
status=p('/proc/self/status').read_text()
assert 'NoNewPrivs:\\t1' in status and 'Seccomp:\\t2' in status
assert int(next(x.split()[1] for x in status.splitlines() if x.startswith('CapEff:')),16)==0
assert not p('/var/run/docker.sock').exists()
assert not p('/Users').exists()
assert 'FACTORY_MIGRATION_URL' not in os.environ
assert len(p('/proc/net/route').read_text().splitlines())==1
for _,name in socket.if_nameindex():
 if name!='lo': assert int(p('/sys/class/net/'+name+'/flags').read_text(),16)&1==0
s=socket.socket(); s.settimeout(1)
assert s.connect_ex(('192.0.2.1',443))!=0
try: p('/escape-test').write_text('synthetic'); raise AssertionError('writable root')
except OSError as e: assert e.errno==errno.EROFS
assert p('/sys/fs/cgroup/memory.max').read_text().strip()=='100663296'
assert p('/sys/fs/cgroup/memory.swap.max').read_text().strip()=='0'
assert p('/sys/fs/cgroup/pids.max').read_text().strip()=='24'
q,period=map(int,p('/sys/fs/cgroup/cpu.max').read_text().split()); assert q/period==0.25
print('docker-default (enforce) process confinement, nonroot, no capabilities, seccomp, no-new-privileges, no socket/host paths, network denied, readonly root; cgroup ceilings verified')''')
    print(result); ok('isolation and configured resource ceilings')
    result=execute(c,'''import time,pathlib
p=pathlib.Path('/sys/fs/cgroup/cpu.stat')
a=dict(x.split() for x in p.read_text().splitlines()); start=time.monotonic()
while time.monotonic()-start<2: pass
b=dict(x.split() for x in p.read_text().splitlines())
assert int(b['nr_throttled'])>int(a['nr_throttled'])
print('CPU throttling events:',int(b['nr_throttled'])-int(a['nr_throttled']))''')
    print(result); ok('CPU enforcement')
    execute(c,'''import pathlib,errno
try:
 with open('/workspace/full','wb') as f:
  for i in range(6): f.write(b'x'*1048576)
 raise AssertionError('quota not enforced')
except OSError as e: assert e.errno==errno.ENOSPC
finally: pathlib.Path('/workspace/full').unlink(missing_ok=True)
'''); ok('workspace byte limit')
    execute(c,'''import subprocess,errno
children=[]
try:
 for i in range(30): children.append(subprocess.Popen(['sleep','10']))
 raise AssertionError('PID limit not enforced')
except OSError as e: assert e.errno==errno.EAGAIN
finally:
 for p in children: p.kill()
 for p in children: p.wait()
'''); ok('PID enforcement and child reaping')
    execute(c,"open('/workspace/result','w').write('synthetic output')")
    output=execute(c,"import os,stat; f=os.open('/workspace/result',os.O_RDONLY|os.O_NOFOLLOW); s=os.fstat(f); assert stat.S_ISREG(s.st_mode) and s.st_size<=1024; print(os.read(f,1025).decode()); os.close(f)")
    assert output=='synthetic output'; ok('bounded output collected before cleanup')
    mem=start('x=bytearray(160*1024*1024)')
    assert docker('wait',mem).stdout.strip()=='137'
    assert json.loads(docker('inspect',mem).stdout)[0]['State']['OOMKilled']; ok('memory OOM enforcement')
    child=start("import subprocess,time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); subprocess.Popen(['python','-c','import signal,time,os; os.setsid(); signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(120)']); time.sleep(120)")
    time.sleep(0.5)
    assert len(docker('top',child).stdout.splitlines())>=4
    docker('stop','--time=1',child)
    assert not json.loads(docker('inspect',child).stdout)[0]['State']['Running']
    assert docker('top',child,check=False).returncode!=0
    ok('forced cancellation of detached signal-ignoring child tree')
    # A separate controller is killed after recording runtime identity; recovery uses that record.
    with tempfile.TemporaryDirectory(prefix='af007-recovery-') as d:
        journal=pathlib.Path(d)/'job.json'; journal.write_text(json.dumps({'container':c})); journal.chmod(0o600)
        controller=sp.Popen(['python3','-c','import time; time.sleep(120)'])
        controller.kill(); controller.wait()
        recovered=sp.run(['python3','-c',"import json,subprocess,sys; n=json.load(open(sys.argv[1]))['container']; subprocess.run(['docker','inspect',n],check=True,stdout=subprocess.DEVNULL); subprocess.run(['docker','rm','-f',n],check=True)",str(journal)],capture_output=True,text=True,timeout=25)
        assert recovered.returncode==0,recovered.stderr
        assert docker('inspect',c,check=False).returncode!=0
        ok('controller interruption and separate-process cleanup recovery')
    with tempfile.TemporaryDirectory(prefix='af007-ipc-',dir=os.environ.get('TMPDIR', '/tmp')) as d:
        os.chmod(d,0o700); path=d+'/control.sock'; token=secrets.token_bytes(32)
        server=socket.socket(socket.AF_UNIX); server.bind(path); os.chmod(path,0o600); server.listen(2)
        def serve():
            for i in range(2):
                conn,_=server.accept()
                with conn: conn.sendall(b'allowed' if hmac.compare_digest(conn.recv(64),token) else b'denied')
        thread=threading.Thread(target=serve); thread.start()
        for sent,expected in [(b'wrong',b'denied'),(token,b'allowed')]:
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(2); client.connect(path); client.sendall(sent); assert client.recv(64)==expected
        thread.join(3); assert not thread.is_alive()
        assert os.stat(path).st_mode&0o777==0o600
        assert os.stat(d).st_mode&0o777==0o700
        server.close()
    ok('private Unix socket permissions and explicit authentication primitive')
finally:
    failures=[]
    for name in created:
        docker('rm','-f',name,check=False)
        if docker('inspect',name,check=False).returncode==0: failures.append(name)
    assert not failures, 'CLEANUP PENDING: '+str(failures)
    assert not docker('ps','-aq','--filter','label=af007.checkpoint='+PREFIX).stdout.strip()
    print('CLEANUP verified: no checkpoint containers remain',flush=True)
print('RESULT: '+str(len(passed))+' passed; 0 failed',flush=True)
