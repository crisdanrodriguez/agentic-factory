#!/usr/bin/env bash
# Only for the disposable GitHub-hosted Ubuntu runner. Never run on an installation host.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]]
[[ $(uname -m) == x86_64 && $(dpkg --print-architecture) == amd64 ]]
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]]
[[ $EUID == 0 ]]
engine='5:29.9.2-1~ubuntu.24.04~noble'
containerd='2.4.2-3~ubuntu.24.04~noble'
work=$(mktemp -d /tmp/af007-apt.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
chmod 755 "$work"
curl --fail --show-error --silent --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o "$work/docker.asc"
fingerprint=$(gpg --batch --show-keys --with-colons "$work/docker.asc" | awk -F: '$1=="fpr" {print $10; exit}')
[[ $fingerprint == 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]]
cat > "$work/docker.sources" <<SOURCE
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: $work/docker.asc
SOURCE
mkdir -p "$work/lists/partial" "$work/packages"
options=(-o "Dir::Etc::sourcelist=$work/docker.sources" -o 'Dir::Etc::sourceparts=-' -o "Dir::State::lists=$work/lists" -o APT::Get::AllowUnauthenticated=false -o Acquire::AllowInsecureRepositories=false -o Acquire::https::Verify-Peer=true -o Acquire::https::Verify-Host=true)
apt-get "${options[@]}" update --error-on=any
# APT verifies InRelease and Packages hashes; only this authenticated origin is used for downloads.
cd "$work/packages"
for spec in "docker-ce=$engine" "docker-ce-cli=$engine" "containerd.io=$containerd"; do
  apt-cache "${options[@]}" policy "${spec%%=*}"
  apt-get "${options[@]}" --print-uris download "$spec"
  apt-get "${options[@]}" download "$spec"
done
sha256sum ./*.deb
# Refuse to replace a runner with existing workloads. No broad prune is used.
if systemctl is-active --quiet docker; then
  [[ -z $(docker --host unix:///var/run/docker.sock ps -aq) ]]
fi
systemctl stop docker.socket docker.service containerd.service
# Conflicting distribution packages may be removed only on this isolated runner.
conflicts=()
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then conflicts+=("$package"); fi
done
if ((${#conflicts[@]})); then apt-get remove -y "${conflicts[@]}"; fi
apt-get install -y --no-install-recommends --allow-downgrades ./*.deb
[[ $(dpkg-query -W -f='${Version}' docker-ce) == "$engine" ]]
[[ $(dpkg-query -W -f='${Version}' docker-ce-cli) == "$engine" ]]
[[ $(dpkg-query -W -f='${Version}' containerd.io) == "$containerd" ]]
# Package file checks include the runtime binaries; any local modification is a failure.
[[ -z $(dpkg --verify docker-ce docker-ce-cli containerd.io) ]]
systemctl restart containerd.service docker.service
python3 "$GITHUB_WORKSPACE/scripts/verify-sandbox-linux.py"
