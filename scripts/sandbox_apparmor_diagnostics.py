"""Read-only AppArmor evidence collection; never loads profiles or changes services."""
import json
import pathlib
import platform
import shutil
import subprocess


def collect_apparmor_diagnostics(info):
    def emit(name, value):
        print('APPARMOR_DIAGNOSTIC ' + json.dumps({'name': name, 'value': value}, sort_keys=True), flush=True)

    def read(path):
        try:
            with open(path, encoding='utf8') as file:
                data = file.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                return {'error': 'Diagnostic file exceeds bound'}
            return data
        except OSError as error:
            return {'error': str(error)}

    def run(name, args):
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
            emit(name, {'exit_code': result.returncode, 'stdout': result.stdout[:32768], 'stderr': result.stderr[:32768]})
        except (OSError, subprocess.TimeoutExpired) as error:
            emit(name, {'error': str(error)})

    emit('Docker.SecurityOptions', info.get('SecurityOptions'))
    emit('kernel.release', platform.release())
    for path in ['/sys/module/apparmor/parameters/enabled', '/sys/kernel/security/lsm']:
        emit(path, read(path))
    profiles = read('/sys/kernel/security/apparmor/profiles')
    emit('docker-default.loaded_profiles', [line for line in profiles.splitlines() if line.startswith('docker-default ')] if isinstance(profiles, str) else profiles)
    config = read('/boot/config-' + platform.release())
    emit('kernel.config', [line for line in config.splitlines() if line.startswith(('CONFIG_SECURITY_APPARMOR', 'CONFIG_LSM='))] if isinstance(config, str) else config)
    run('apparmor.service', ['systemctl', 'show', 'apparmor.service', '--property=LoadState,ActiveState,SubState,Result,ExecMainStatus'])
    parser = shutil.which('apparmor_parser')
    emit('apparmor_parser.path', parser)
    if parser:
        run('apparmor_parser.version', [parser, '--version'])
    run('apparmor.packages', ['dpkg-query', '-W', '-f=${Package} ${Version} ${Status}\n', 'apparmor', 'apparmor-utils'])
    run('docker.apparmor.journal', ['journalctl', '--no-pager', '-b', '-u', 'docker.service', '--grep=[Aa]pp[Aa]rmor', '-n', '50', '-o', 'cat'])
    path = pathlib.Path('/etc/docker/daemon.json')
    if path.exists():
        try:
            configuration = json.loads(path.read_text())
            emit('docker.config.keys', sorted(configuration))
            emit('docker.config.apparmor', {key: value for key, value in configuration.items() if 'apparmor' in key.lower() or 'apparmor' in json.dumps(value).lower()})
        except (OSError, ValueError) as error:
            emit('docker.config', {'error': str(error)})
    else:
        emit('docker.config', 'No /etc/docker/daemon.json')
