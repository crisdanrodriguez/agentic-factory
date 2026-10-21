"""Fail-closed preflight for the reviewed native Linux CI runtime; creates no containers."""
import json
import pathlib
import platform
import subprocess


def command(*args):
    return subprocess.check_output(args, text=True, timeout=30).strip()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Native Linux AMD64 is required')
packages = {'docker-ce': '5:29.9.2-1~ubuntu.24.04~noble',
            'docker-ce-cli': '5:29.9.2-1~ubuntu.24.04~noble',
            'containerd.io': '2.4.2-3~ubuntu.24.04~noble'}
for name, expected in packages.items():
    actual = command('dpkg-query', '-W', '-f=${Version}', name)
    require(actual == expected, f'Unexpected package: {name} {actual}')
    print(f'PACKAGE {name}={actual}', flush=True)
require(not command('dpkg', '--verify', *packages), 'Installed package contents differ')
for service, binary in [('docker', '/usr/bin/dockerd'), ('containerd', '/usr/bin/containerd')]:
    pid = command('systemctl', 'show', '--property=MainPID', '--value', service)
    require(pid.isdigit() and int(pid) > 1, f'{service} is not running')
    require(str(pathlib.Path(f'/proc/{pid}/exe').resolve()) == binary, f'Unexpected active {service} executable')
    arguments = pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0', b' ').decode()
    require('tcp://' not in arguments, 'TCP daemon access is forbidden')
require(command('/usr/bin/runc', '--version').splitlines()[0] == 'runc version 1.5.2', 'Unreviewed runc binary')
require(' 2.4.2 ' in command('/usr/bin/containerd', '--version'), 'Unreviewed containerd binary')
# containerd can perform registry transfers itself; its TLS build matters as well.
require('go1.26.10' in command('go', 'version', '-m', '/usr/bin/containerd').splitlines()[0], 'Unreviewed containerd Go TLS implementation')
docker = ['docker', '--host', 'unix:///var/run/docker.sock']
version = json.loads(command(*docker, 'version', '--format', '{{json .Server}}'))
components = {item['Name']: item['Version'] for item in version['Components']}
for name, expected in {'Engine': '29.9.2', 'containerd': '2.4.2', 'runc': '1.5.2'}.items():
    require(components.get(name) == expected, f'Active component mismatch: {name}')
require(version['GoVersion'] == 'go1.26.10', 'Unreviewed daemon Go TLS implementation')
info = json.loads(command(*docker, 'info', '--format', '{{json .}}'))
require(info['OSType'] == 'linux' and info['Architecture'] == 'x86_64', 'Wrong daemon platform')
require(info['DefaultRuntime'] == 'runc' and info['CgroupVersion'] == '2', 'Required runtime/cgroups unavailable')
require(info['Runtimes']['runc']['path'] in ('runc', '/usr/bin/runc'), 'Unexpected runc runtime path')
for option in ('name=seccomp,profile=builtin', 'name=cgroupns', 'name=apparmor'):
    require(option in info['SecurityOptions'], f'Missing security option: {option}')
for capability in ('MemoryLimit', 'SwapLimit', 'CpuCfsPeriod', 'CpuCfsQuota', 'PidsLimit'):
    require(info.get(capability) is True, f'Missing resource control: {capability}')
require({'cpu', 'memory', 'pids'} <= set(pathlib.Path('/sys/fs/cgroup/cgroup.controllers').read_text().split()), 'Missing cgroup controllers')
registry = info['RegistryConfig']
require(not registry.get('Mirrors'), 'Registry mirrors require separate review')
require(all(value.get('Secure') is True for value in registry.get('IndexConfigs', {}).values()), 'Insecure registry configuration')
require(set(registry.get('InsecureRegistryCIDRs', [])) <= {'127.0.0.0/8', '::1/128'}, 'Unexpected insecure registry ranges')
configuration = pathlib.Path('/etc/docker/daemon.json')
if configuration.exists():
    config = json.loads(configuration.read_text())
    require(not config.get('insecure-registries') and not config.get('registry-mirrors'), 'Registry overrides are forbidden')
    require(all(host.startswith('unix://') or host == 'fd://' for host in config.get('hosts', [])), 'Nonlocal daemon listener')
print(json.dumps({'components': components, 'go': version['GoVersion'], 'security': info['SecurityOptions'],
                  'cgroup': info['CgroupVersion'], 'runtime': info['DefaultRuntime']}, sort_keys=True))
print('PASS: Linux package, active runtime, registry policy and security preflight')
