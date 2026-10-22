"""Strict parsing of the reviewed containerd CLI format; no runtime operations."""
import re


def require_containerd_version(output):
    # containerd v2.4.2 VersionPrinter: name, package, version, revision.
    # Docker's reviewed package sets version.Package=containerd at link time.
    match = re.fullmatch(r'containerd (?:containerd|github\.com/containerd/containerd/v2) v([0-9]+\.[0-9]+\.[0-9]+) ([a-f0-9]{40})', output)
    if match is None or match.group(1) != '2.4.2':
        raise RuntimeError('Unreviewed containerd binary version or output format')


def embedded_go_version(output, binary):
    """Parse the header of `go version -m BINARY`, not the inspecting Go tool's version."""
    lines = output.splitlines()
    if not lines:
        raise RuntimeError('Missing embedded Go version')
    match = re.fullmatch(re.escape(binary) + r':[ \t]+(go[0-9]+\.[0-9]+\.[0-9]+)', lines[0])
    if match is None or any(not line.startswith('\t') for line in lines[1:]):
        raise RuntimeError('Malformed embedded Go build information')
    return match.group(1)


def require_reviewed_go_build(component, version, go_version):
    # Explicitly reviewed builds, not a minimum-version policy or interchangeable Go branches.
    reviewed = {'Engine': ('29.9.2', 'go1.26.10'), 'containerd': ('2.4.2', 'go1.27.3')}
    if component not in reviewed or (version, go_version) != reviewed[component]:
        raise RuntimeError('Unreviewed component/Go TLS build combination')


def require_api_components(components):
    reviewed = {'Engine': ('29.9.2',), 'containerd': ('2.4.2', 'v2.4.2'), 'runc': ('1.5.2',)}
    for name, representations in reviewed.items():
        if components.get(name) not in representations:
            raise RuntimeError(f'Active component mismatch: {name}')


def require_default_apparmor(options):
    """Accept only the reviewed Docker 29.9.2 built-in profile representation."""
    if not isinstance(options, list) or any(not isinstance(option, str) for option in options):
        raise RuntimeError('Malformed Docker security options')
    entries = [option for option in options if 'apparmor' in option.lower()]
    if entries != ['name=apparmor,profile=default']:
        raise RuntimeError('Required built-in AppArmor profile is unavailable or unreviewed')


def require_host_apparmor(enabled, lsm, profiles, arguments, configuration):
    """Validate read-only host evidence; never load or replace a profile."""
    if enabled.strip() != 'Y' or 'apparmor' not in lsm.strip().split(','):
        raise RuntimeError('AppArmor kernel/LSM support is unavailable')
    entries = [line for line in profiles.splitlines() if line.startswith('docker-default')]
    if entries != ['docker-default (enforce)']:
        raise RuntimeError('docker-default is not uniquely loaded in enforce mode')
    # An alternate config file could hide a template override from the default file.
    if any('apparmor' in arg.lower() or arg.startswith('--config-file') for arg in arguments):
        raise RuntimeError('Docker AppArmor/configuration override is forbidden')
    if not isinstance(configuration, dict) or any('apparmor' in key.lower() for key in configuration):
        raise RuntimeError('Docker AppArmor template override is forbidden')
