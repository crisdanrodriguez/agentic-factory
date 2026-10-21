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
