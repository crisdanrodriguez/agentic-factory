"""Remove only resources registered by this sandbox test run; report all cleanup failures."""
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import time

root = pathlib.Path(os.environ['AF_SANDBOX_TEST_ROOT'])
if not re.fullmatch(r'/tmp/af007-ci-[0-9]+-[0-9]+', str(root)) or root.is_symlink():
    raise RuntimeError('Unsafe sandbox test root')
failures = []
docker = ['docker', '--host', 'unix:///var/run/docker.sock']


def run(*args):
    return subprocess.check_output([*docker, *args], text=True, timeout=30).strip()


if root.exists():
    # A killed test controller can leave its broker child behind. Match its exact config directory.
    for entry in (pathlib.Path('/proc').iterdir() if pathlib.Path('/proc').exists() else []):
        if not entry.name.isdigit():
            continue
        try:
            args = (entry / 'cmdline').read_bytes().split(b'\0')
            if any(arg.decode(errors='replace').startswith(str(root) + '/') for arg in args) and any(b'sandbox-broker.js' in arg for arg in args):
                os.kill(int(entry.name), signal.SIGKILL)
                for _ in range(50):
                    try:
                        state = (entry / 'stat').read_text().rsplit(')', 1)[1].split()[0]
                        if state == 'Z':
                            break
                    except FileNotFoundError:
                        break
                    time.sleep(0.02)
                else:
                    failures.append(f'Test broker PID {entry.name} did not terminate')
                print(f'CLEANUP signaled test broker PID {entry.name}')
        except ProcessLookupError:
            pass
        except FileNotFoundError:
            pass
    time.sleep(0.1)
    for registry, label in [('instances', 'af.instance'), ('checkpoints', 'af007.checkpoint')]:
        file = root / registry
        try:
            require_values = file.read_text().splitlines() if file.exists() else []
            for value in require_values:
                if not re.fullmatch(r'[a-f0-9]{64}|af007-probe-[a-f0-9]{10}', value):
                    raise RuntimeError('Invalid registered cleanup identity')
                ids = run('ps', '-aq', '--filter', f'label={label}={value}').splitlines()
                for identifier in ids:
                    try:
                        metadata = json.loads(run('inspect', identifier))[0]
                        if metadata['Config']['Labels'].get(label) != value:
                            raise RuntimeError('Cleanup ownership mismatch')
                        run('rm', '-f', identifier)
                        print(f'CLEANUP removed container {identifier}')
                    except Exception as error:
                        failures.append(str(error))
                if run('ps', '-aq', '--filter', f'label={label}={value}'):
                    raise RuntimeError(f'Cleanup pending: {label}={value}')
        except Exception as error:
            failures.append(str(error))
    if not failures:
        try:
            shutil.rmtree(root)
            if root.exists():
                raise RuntimeError('Temporary resources still exist')
        except Exception as error:
            failures.append(str(error))
if failures:
    for failure in failures:
        print('CLEANUP FAILURE: ' + failure, file=sys.stderr)
    sys.exit(1)
print('PASS: registered containers and test directory/socket resources absent')
