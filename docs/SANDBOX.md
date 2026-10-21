# Restricted job sandbox — AF-007 implementation checkpoint

AF-007 is in progress, not accepted or complete. The preliminary nine-property feasibility checkpoint is retained as `tests/sandbox/feasibility.py`. Local broker integration tests supplement that evidence. Architecture manifests are pinned in `sandbox/images.json`, and a mandatory separate Ubuntu 24.04 CI job is configured. Native Linux AMD64 execution and online image preparation remain unverified because the local registry TLS prerequisite is unresolved. Do not use this checkpoint for hostile or business workloads.

## Trust and scope

The Job Execution Sandbox is distinct from the future AgentRuntime. This milestone permits only network-disabled noninteractive jobs. Future reasoning agents may require network access under separately reviewed policies.

The trusted coordinator resolves organization/project authority, approved execution context, policy revision, environment, exact command, bounded source contents, and permitted output paths. Installation-owned grant configuration is not task input. The scope-bound adapter requires an authorization callback on every operation; it can use the existing database-backed `authorizeJob` boundary without exposing database credentials to the broker. That callback must also enforce the application's approved execution policy; identity fields alone are not authorization.

The broker runs as a separate trusted process. Its private Unix socket uses a 0700 directory and 0600 socket. A random 256-bit credential authenticates messages and responses with HMAC; request timestamps and durable nonces reject replay, including across restart. Changes to grants require broker restart. Removed or changed grants cancel outstanding executions during reconciliation.

The broker can control Docker and is therefore highly privileged relative to its Linux container host. The coordinator and broker OS user remain trusted. Same-user host compromise is outside this boundary. Containers do not receive their credentials, socket, host directories, or inherited environment. There is no TCP listener, remote control service, provider SDK, or unrestricted Docker option endpoint.

## Execution controls

Containers use a fixed non-root keeper UID (65533). Project processes run as a different non-root UID (65534), with a read-only root filesystem, all capabilities dropped, no-new-privileges, default seccomp, network disabled, and explicit CPU/memory/swap/PID/file-descriptor limits. Before a project starts, an in-container helper checks actual cgroup ceilings, privileges, network interfaces/routes, read-only root, and workspace capacity. Missing controls fail closed.

A restricted tmpfs workspace and temporary directories bound writable storage. These memory-backed filesystems are intended only for small tasks, not large datasets, model checkpoints, or general ML training. No host bind mounts or Docker socket mounts are used. Container logs are disabled; project output is collected only through explicitly authorized files.

Inputs are bounded literal contents from trusted grants, not arbitrary host paths or archives. Path validation rejects traversal and ambiguous components. Output collection uses descriptor-relative no-follow traversal, checks regular-file type and link count, and enforces an aggregate byte limit. Residual project processes are stopped and killed before collection; inability to quiesce them fails collection. The keeper uses a different UID. Outputs are collected before container removal and retained as small private journal snapshots with digests. This is not the future ArtifactStore, a publication mechanism, or proof of scientific validity.

## Durable lifecycle

Execution intent is fsynced before container creation. Organization, project, run, and idempotency key define job identity. A repeated request with different content is rejected. One nonterminal job is allowed; cleanup-pending jobs block new starts. Journal capacity is bounded at 100 records and requires explicit operator retention review when full.

Containers have instance, job, and request-digest labels. Restart matches those labels to intent; unknown labeled containers require investigation rather than automatic adoption or deletion. Interrupted intent/preparation/launch acknowledgement fails conservatively. A recorded running Docker exec is reconciled from runtime state, never from elapsed-time assumptions.

The terminal phase is recorded only after cleanup is confirmed; the intended execution outcome can already be present in a cleanup-pending record. Failed cleanup retains `cleanup-pending`. The adapter raises an explicit cleanup-pending error rather than reporting success or confirmed cancellation. Reconciliation retries removal. Failed jobs can retain bounded output metadata internally, but no workflow verification or objective assessment is changed by this broker.

The broker timer enforces deadlines while it runs. Broker outage, daemon outage, host suspension, or clock changes can delay enforcement. Deadline expiry after restart fails conservatively even if a job might have finished earlier: the Docker exec interface does not provide reliable historical completion time. Loss of runtime execution records causes failure, not a fabricated success. A keeper has a one-hour absolute lifetime; this is not a substitute for short broker deadlines. Tmpfs contents may be lost if the container/daemon stops; such loss cannot be reported as successful artifact recovery.

## Installation and private configuration

Use the repository's pinned Node 24.22.0 and npm 11.9.0. Python 3 and the Docker CLI are additionally required for maintained feasibility tests. Installation retains the explicit dependency patch:

```sh
npm ci --ignore-scripts
npm run deps:patch
npm run deps:check
npm run build
```

Do not perform registry operations with the unresolved Engine 29.9.1 certificate-revocation issue. Use a maintained Docker installation containing the fix documented for Engine 29.9.2 or a later reviewed release, with certificate verification enabled. No insecure-registry or TLS-bypass change is part of AF-007. Existing cached-image local tests use `--pull=never`; Docker API container creation does not automatically pull images.

The current local fixture is ARM64 Python at `sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e`. This is not an AMD64 compatibility claim. The cached OCI index identifies AMD64 manifest `sha256:08b493e9c2f92a0f84e45062338a1503d0f585d63ba8783baad5a24cdf200894`; its platform descriptor is recorded, but its layers and execution have not been verified locally. ARM64 manifest `sha256:ff089de2ebe52f328c4834221097e20eae7f7e4148ea06ac42bd8440d3c79094` is verified from cached content. Native Linux CI must pull and verify the pinned platform after its TLS gate passes.

A private configuration file contains `instance` (64 hex characters), `token` (64 cryptographically random hex characters), absolute `stateDirectory` and `dockerSocket`, architecture-specific `images.arm64` and `images.amd64` digest references, and trusted `grants`. Create the parent directory with mode 0700 and file with mode 0600. Generate random credentials locally; never commit them. See `grantSchema` for the strict grant format. Do not copy request-supplied identity into this configuration as an authorization shortcut. No guided configuration generator is implemented in AF-007.

Start with a deliberately minimal environment so the broker does not inherit database or provider credentials:

```sh
env -i PATH="$PATH" node dist/runtime/sandbox-broker.js start /absolute/private/config.json
```

This starts only the execution broker, not local WorkItem intake. It creates no Telegram, GitHub, agent, or deployment integration.

## Cleanup and recovery

Normal shutdown closes the socket and releases the process lock. It does not promise to cancel running containers; restart is needed to reconcile them. After a process crash, investigate the recorded PID and runtime resources before recovery:

```sh
env -i PATH="$PATH" node dist/runtime/sandbox-broker.js recover-lock /absolute/private/config.json
env -i PATH="$PATH" node dist/runtime/sandbox-broker.js start /absolute/private/config.json
```

Recovery refuses to clear a lock while its recorded PID exists, including a reused PID. Do not blindly delete journals, locks, sockets, containers, volumes, or unrelated workloads. The recovery command clears only the verified dead-process lock and owned socket; normal startup then reconciles the journal. Automatic service supervision and automatic stale-lock recovery are not implemented at this checkpoint. If cleanup remains pending, restore Docker availability and restart/reconcile; preserve evidence until removal is confirmed.

## Verification and pending acceptance

```sh
export AF_DOCKER_SOCKET=/absolute/path/to/local/docker.sock
export AF_SANDBOX_IMAGE=python@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e
npm run test:sandbox
```

The fixture digest above is local ARM64 evidence only. Tests require a real runtime and fail if configuration or capabilities are absent. They do not skip unavailable checks. Use only synthetic local resources. Native Linux AMD64 execution, the configured mandatory Ubuntu 24.04 CI job, online image preparation, and remaining adversarial acceptance tests must pass before AF-007 can be marked complete.

The installation preflight command is `npm run sandbox:image`. It refuses registry operations before contacting a registry unless the reviewed Engine TLS baseline passes, then pulls the pinned index for the native architecture and verifies the manifest descriptor and available content. `npm run sandbox:image -- --offline` verifies existing local content only and explicitly does not clear registry TLS readiness. The broker API never pulls an image itself. CI runs the online gate as a required step; an incompatible runner fails rather than bypassing the gate. A patched runner/runtime remains an installation prerequisite, not an automatic privileged host upgrade.

## Pinned Linux CI provisioning (implementation pending hosted verification)

The sandbox job uses an isolated GitHub-hosted `ubuntu-24.04` AMD64 runner. It does not use or upgrade the owner's Docker Desktop. `scripts/provision-sandbox-ci.sh` refuses other host environments and installs only these exact packages:

- `docker-ce=5:29.9.2-1~ubuntu.24.04~noble`
- `docker-ce-cli=5:29.9.2-1~ubuntu.24.04~noble`
- `containerd.io=2.4.2-3~ubuntu.24.04~noble`

The script uses Docker's HTTPS APT repository in an isolated source/list directory, pins the Docker signing-key fingerprint, requires authenticated repository metadata, and downloads exact versions through APT's hash verification. Package origins, archive SHA-256 hashes and installed versions are printed. It checks package file integrity and refuses an existing container workload before replacing runner packages. No convenience installer, mutable version fallback, or insecure repository is used. A missing package, changed signing key, unexpected component or unavailable control fails the job and requires review.

`verify-sandbox-linux.py` checks active systemd process executables, Docker-reported Engine/containerd/runc versions, packaged binary versions, daemon and containerd Go TLS builds, default runc, cgroup v2 CPU/memory/PID controls, built-in seccomp, AppArmor, cgroup namespaces, and registry security settings. The reviewed expectations are Engine 29.9.2, containerd 2.4.2, runc 1.5.2, Go 1.26.10 for Engine 29.9.2, and Go 1.27.3 for the pinned containerd 2.4.2 package. These are required expectations, not claimed measurements from an executed Ubuntu job. The GitHub runner's Go inspection tool is required; missing tooling fails closed.

Sources: [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [official Noble AMD64 packages](https://download.docker.com/linux/ubuntu/dists/noble/pool/stable/amd64/), [Engine 29 release/security notes](https://docs.docker.com/engine/release-notes/29/), and [runc advisories](https://github.com/opencontainers/runc/security/advisories). This pinned review is not a guarantee against future advisories; reassess it before changing versions or enabling a future runtime.

After provisioning, the job independently installs npm dependencies with lifecycle scripts disabled, explicitly applies/verifies the accepted pg-boss patch, builds the application, tests the provisioning/image/cleanup tooling with synthetic fixtures, securely pulls the locked image, compiles the integration tests, and runs all broker and feasibility tests. `sandbox:image` reports the locked index, selected manifest, resolved configuration digest and platform. Generic registry TLS errors are not labeled as certificate revocation: policy rejection happens before pull; actual pull errors retain Docker's diagnostics. There is no TLS bypass or HTTP fallback.

The test root is `/tmp/af007-ci-<run-id>-<attempt>`, mode 0700. Tests record random instance/checkpoint identities before creating containers, and place temporary directories and sockets under that root. The final `if: always()` cleanup step terminates remaining broker processes tied to that root, removes only registered labeled containers, verifies their absence, and removes temporary resources. Cleanup reports its own failure without replacing the preceding step's failure; uncertain cleanup retains the root and records. Runner destruction remains the final boundary after an unrecoverable host failure or forced job termination. No workflow can promise that a cleanup process executes after a VM disappears.

For an already provisioned isolated runner, the relevant commands are:

```sh
sudo python3 scripts/verify-sandbox-linux.py
npm run deps:patch
npm run deps:check
npm run build
npm run test:sandbox-tools
npm run sandbox:image
npm run test:sandbox
python3 scripts/cleanup-sandbox-ci.py
```

The workflow sets `AF_DOCKER_SOCKET`, `AF_SANDBOX_IMAGE`, `AF_SANDBOX_TEST_ROOT` and `TMPDIR`; cleanup is a separate unconditional step, not a command chained after a successful test. Do not run the provisioning script on a persistent development or business host.

Linux success establishes Linux AMD64 evidence only. macOS ARM64 retains its historical offline evidence and needs secure image preparation plus the full sandbox suite on an approved official Docker Desktop runtime before cross-platform completion can be claimed.


### Explicit Go TLS build baseline

The [Go release history](https://go.dev/doc/devel/release#go1.27.3) records crypto/x509 security fixes in both Go 1.27.3 and Go 1.26.10, released October 19, 2026. [Docker Engine 29.9.2 release notes](https://docs.docker.com/engine/release-notes/29/) identify the CVE-2026-111943 certificate-chain fix and Engine's Go 1.26.10 build. Following owner security review, the exact authorized combinations are:

| Component | Exact version | Exact embedded/runtime Go version |
|---|---|---|
| Docker Engine | 29.9.2 | go1.26.10 |
| containerd from `containerd.io=2.4.2-3~ubuntu.24.04~noble` | 2.4.2 | go1.27.3 |

These branches are explicitly reviewed per component, not interchangeable or a generic minimum-version policy. Newer versions, Go 1.27.2, Go 1.26.9, custom builds and malformed/missing build metadata are rejected. Exact package pins and integrity checks run first. Active executable path and file identity must match the installed binary. The preflight parses the complete header produced by `go version -m /usr/bin/containerd`, which reads the binary's embedded build information rather than the inspection tool's own version. It prints the extracted version and checks the exact component/version/Go tuple. Docker API component versions and daemon GoVersion retain exact checks; the containerd CLI parser and runc checks are unchanged.

This corrects the assumption in the historical checkpoint that both components must share Go 1.26.10. It does not itself establish that all later isolation and sandbox checks pass, and it does not complete macOS ARM64 validation.

## Required AppArmor capability and process confinement

The reviewed Ubuntu AMD64 baseline requires exactly one Docker security entry,
`name=apparmor,profile=default`. Static preflight also reads the enabled kernel
parameter, active LSM list, and loaded profiles and requires
`docker-default (enforce)`. Daemon AppArmor template overrides and alternate
configuration-file arguments are rejected. These checks do not install tooling,
load profiles, activate services, or alter kernel configuration.

Static metadata is not proof that a project process is confined. The broker
explicitly selects `apparmor=docker-default`, inspects each container before
creating an exec, and requires `AppArmorProfile === docker-default`. A trusted
Python wrapper reads its own `/proc/self/attr/current` and requires
`docker-default (enforce)` before replacing itself with the authorized command.
The preparation helper independently checks confinement. The maintained broker
integration test checks the same attribute inside the project command, while
the feasibility suite checks both inspection metadata and a running process.
No unconfined or complain-mode fallback is supported.

The Python wrapper and trusted helpers use isolated Python mode (`-I`) to prevent
workspace modules from shadowing the confinement checks. The wrapper uses the existing trusted Python environment and no additional
dependency. This does not establish macOS ARM64 compatibility: historical offline
results remain preliminary, and the required AppArmor baseline must not be
silently omitted on Docker Desktop.
