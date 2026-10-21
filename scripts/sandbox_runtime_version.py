"""Strict parsing of the reviewed containerd CLI format; no runtime operations."""
import re


def require_containerd_version(output):
    # containerd v2.4.2 VersionPrinter: name, package, version, revision.
    # Docker's reviewed package sets version.Package=containerd at link time.
    match = re.fullmatch(r'containerd (?:containerd|github\.com/containerd/containerd/v2) v([0-9]+\.[0-9]+\.[0-9]+) ([a-f0-9]{40})', output)
    if match is None or match.group(1) != '2.4.2':
        raise RuntimeError('Unreviewed containerd binary version or output format')
