# AF-007 local implementation checkpoint — 2026-10-21

## Status

AF-007 is not complete or accepted. Offline implementation and local ARM64 checks have progressed, but online image provisioning is blocked by the installed Engine 29.9.1 TLS prerequisite. Native Linux AMD64 execution and the newly configured hosted sandbox job have not run. No commit, push, merge, publication, deployment, or AF-023 implementation occurred.

Core Engine code, provider contracts, PostgreSQL migrations, dependency versions/lockfile, strict compiler settings, MIT LICENSE, and the accepted pg-boss declaration patch are unchanged. AF-004–006 acceptance documentation now records merge `2705aac` and the owner-confirmed main-branch GitHub Actions success; historical verification records retain their original evidence. This does not claim a hosted run for these uncommitted AF-007 changes.

## Environment and commands

Tested Node 24.22.0 and npm 11.9.0 were selected through `PATH=/private/tmp/af-node-bin:$PATH`. Docker Desktop 4.96.0 provides Engine 29.9.1, containerd 2.4.2, runc 1.5.2, cgroup v2, built-in seccomp, and Linux ARM64 on macOS ARM64. These results do not establish native Linux AMD64 compatibility.

Installation-specific socket paths below are represented by `AF_DOCKER_SOCKET`; locally this pointed to the owner's Docker Desktop Unix socket. Tests used no provider credentials or business data.

| Command | Exact final result |
|---|---|
| `npm run deps:check` | Exit 0; `pg-boss 12.38.0 declaration patch verified (already applied).` |
| `npm run lint` | Exit 0; no warnings/errors |
| `npm run typecheck` | Exit 0; strict settings unchanged |
| `npm test` | Exit 0; tests 63, pass 63, fail 0, cancelled 0, skipped 0, todo 0 |
| `npm run build` | Exit 0 |
| `npm run test:deps` | Exit 0; tests 7, pass 7, fail 0, cancelled 0, skipped 0, todo 0 |
| `docker compose up -d --pull never --wait postgres` | Exit 0; project synthetic PostgreSQL service healthy; existing volume preserved |
| `npm run test:compatibility` | Exit 0; PostgreSQL 18.6; all four assertions passed: migration rerun, atomic commit, rollback, restricted-role RLS/DDL |
| `npm run test:state` | Exit 0; tests 5, pass 5, fail 0, cancelled 0, skipped 0, todo 0 |
| `npm run test:queue` | Exit 0; tests 8, pass 8, fail 0, cancelled 0, skipped 0, todo 0 |
| `npm run test:simulations` | Exit 0; tests 24, pass 24, fail 0, cancelled 0, skipped 0, todo 0 |
| `npm run test:sandbox` | Exit 0; Node tests 14, pass 14, fail 0, cancelled 0, skipped 0, todo 0; then Python feasibility `RESULT: 9 passed; 0 failed` |
| `npm run sandbox:image -- --offline` | Exit 0; cached ARM64 manifest matched `ff089de2ebe52f328c4834221097e20eae7f7e4148ea06ac42bd8440d3c79094` |
| `npm run sandbox:image` | Exit 1, expected fail-closed result: `Registry access refused: reviewed Engine 29.9.2 or later 29.9 patch is required for the TLS revocation fix. No registry request was made.` |
| `git diff --check` | Exit 0 |

Combined Node suites: 121 tests passed. Separately, nine maintained Python feasibility properties and four PostgreSQL compatibility assertions passed. The sandbox environment was:

```sh
export AF_DOCKER_SOCKET=/absolute/path/to/local/docker.sock
export AF_SANDBOX_IMAGE=python@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e
npm run test:sandbox
```

The source fixture is a cached OCI index. Both platform manifest descriptors were inspected locally and recorded in `sandbox/images.json`. ARM64 content was verified and executed. AMD64 metadata had no locally available image configuration/layers; it was not executed. No registry pull was performed during this implementation checkpoint.

## Acceptance mapping

| Requirement | Actual local evidence | Remaining limit |
|---|---|---|
| Coordinator/workspace/process separation | `isolation and configured resource ceilings` verifies non-root UID, zero effective capabilities, no-new-privileges, seccomp, absent Docker socket/host paths/database variable, read-only root, and disabled network | Shared kernel/VM and trusted host user remain security boundaries, not a proof against all escapes |
| Python/general software and explicit limits | `sandbox stages a bounded general software workspace and collects shell output`; Python execution cases; feasibility CPU, OOM, PID, workspace and bounded-output checks | Initial image supports Python and shell utilities; no large data volumes or arbitrary environment builds |
| Cancellation kills child processes | `forced cancellation of detached signal-ignoring child tree`; `sandbox restart reconciles running job and cancellation rejects late completion` | Forced removal can discard in-progress output; daemon outage delays confirmation |
| Scope, policy and authorization | `sandbox identical project execution and operation IDs remain organization scoped`; authenticated socket case rejects wrong credentials, context/project/policy/source mismatches and raised memory limits | Installation grants and coordinator authorization callback are trusted; this is not end-user pairing/authentication |
| Replay and request validation | `sandbox authentication rejects invalid credentials and expired requests`; `sandbox replay protection survives authenticator restart and rejects clock rollback`; unknown Docker fields test | Clock rollback fails closed for requests; outages can delay execution deadlines |
| Path and output safety | Path validation test; private-file symlink/hard-link/mode/size tests; real-container symbolic, hard-linked, special, oversized and missing-output cases | Small output snapshots only; no ArtifactStore or scientific verification |
| Idempotency and one sandbox | Authenticated socket test repeats starts and restarts; cancellation test rejects a second active operation; organization test proves distinct scoped identities | No promise of exactly-once external execution across every infrastructure failure |
| Durable recovery | `sandbox separate broker process recovers after SIGKILL without duplicate execution`; `sandbox interrupted launch cannot claim success or relaunch without evidence` | Dead-process lock recovery is explicit; uncertain launch acknowledgement fails conservatively |
| Cleanup failures | `sandbox timeout fails and cleanup failure remains explicit until reconciliation succeeds`; `sandbox refuses to adopt unknown labeled resources`; feasibility cleanup assertions | Unknown resources or corrupt journals require operator review; no blanket cleanup command |
| Fail-closed controls | `sandbox preflight fails closed for missing isolation controls and unsupported runtime`; actual per-container cgroup checks; online registry refusal | Linux hosted runtime baseline is unverified and may fail until a patched runtime is available |

The nine maintained feasibility results were: isolation/configured ceilings, CPU enforcement (20 observed throttling events), workspace byte limit, PID enforcement/reaping, bounded output collection, memory OOM enforcement, detached child-tree cancellation, controller interruption/recovery, and private Unix socket permissions/authentication. All checkpoint containers were removed.

## Failures encountered and corrected

- The first broker integration attempt raced direct calls against the socket service's reconciliation timer. The test was corrected to submit execution through the serialized authenticated protocol; the final integration suite passes. Production use is through that protocol.
- A test-only dynamic import of `node:events.once` produced TS2339. A normal named import resolved it; strict checks were not weakened.
- The earlier preliminary feasibility assertion requiring loopback to be the only interface was too strict for dormant kernel tunnel devices. The maintained test rejects active non-loopback interfaces and routes and verifies an unreachable synthetic destination instead.
- Online provisioning remains an intentional failure, not a resolved issue or skipped test. It requires a patched runtime before continuing.

## Handoff limits

See `SANDBOX.md` for installation, private grants, preflight, cleanup, and recovery commands. No real agents, real ML training, networking for project jobs, Telegram, GitHub integration, deployment, or WorkItem intake were added. No TLS validation was disabled and no insecure registry setting was introduced. The existing private Docker installation was not upgraded or reconfigured.

The Ubuntu 24.04 sandbox CI job is separate, mandatory, and has no skip/failure suppression. It first gates registry access, then verifies the architecture pin and runs the sandbox suites. Its actual execution remains unverified. AF-007 must remain in progress until the runtime prerequisite and platform verification are resolved and the implementation receives human review.

## Linux provisioning correction — local verification, 2026-10-21

Status remains **not complete; Linux hosted verification pending and macOS secure validation outstanding**. The pinned Ubuntu workflow and mandatory cleanup are implemented but have not been executed on GitHub. No branch was committed or pushed; the current workflow has only push/pull-request triggers, so it cannot run these uncommitted changes remotely. Prior ARM64 offline evidence above is preserved, not promoted to proof of the corrected Linux workflow.

| Command | Result from this correction |
|---|---|
| `npm run lint` | Exit 0, no warnings/errors |
| `npm run typecheck` | Exit 0, strict checking preserved |
| `npm test` | Exit 0; 65 tests, 65 passed, 0 failed/cancelled/skipped/todo |
| `npm run test:deps` | Exit 0; 7 tests, 7 passed, 0 failed/cancelled/skipped/todo |
| `npm run test:sandbox-tools` | Exit 0; 9 synthetic tooling tests, 9 passed, 0 failed/cancelled/skipped/todo |
| `npm run build` | Exit 0 |
| `bash -n scripts/provision-sandbox-ci.sh` | Exit 0 |
| Python AST parsing of preflight, cleanup and feasibility scripts | Exit 0; all three parsed |
| `docker compose ps --all` | Exit 1; local Docker Desktop Unix socket does not exist |
| `npm run test:compatibility` | Exit 1; PostgreSQL connection refused at `127.0.0.1:55432`, before compatibility assertions |
| `npm run test:state` | Exit 1; 5 tests, 0 passed, 5 failed because PostgreSQL is unavailable |
| `npm run test:queue` | Exit 1; 8 tests, 1 passed, 7 failed; database-independent budget test passed, database tests received `ECONNREFUSED` |
| `npm run test:simulations` | Exit 1; 24 tests, 0 passed, 24 failed with `ECONNREFUSED` |
| Native Linux `npm run test:sandbox` | Not run: no provisioned GitHub-hosted runner with these uncommitted changes |

The first database attempts received sandbox `EPERM`; repeating outside that sandbox confirmed actual `ECONNREFUSED`. An initial new fixture caused TS2556 (tuple spread); it was corrected and strict compilation rerun successfully. No test suppression or database/schema changes were introduced to conceal these failures.

### Acceptance mapping for this correction

| Requirement | Actual test/check and evidence boundary |
|---|---|
| Exact official authenticated packages | `provision-sandbox-ci.sh`: isolated signed APT source, fixed fingerprint, exact download/install versions and package verification; hosted execution pending |
| Actual running components and isolation configuration | `verify-sandbox-linux.py`; hosted execution pending. Unit `sandbox native AMD64 preflight accepts only the exact reviewed component combination` rejects old/new/absent components |
| Version-policy rejection before registry access | `synthetic image tooling: old`, asserts no pull command |
| Insecure registry rejection | `synthetic image tooling: insecure`, asserts no pull command |
| Registry diagnostic distinct from policy/revocation | `synthetic image tooling: tls`, preserves unknown-CA error without claiming revocation |
| Immutable platform and configuration identity | `synthetic image tooling: valid` and `mismatch`; actual Linux image pull pending |
| Unconditional cleanup permitted without skipped mandatory steps | `review regression: only unconditional sandbox cleanup may use a workflow condition`, including negative condition/suppression mutations |
| Cleanup success and independent failure | `synthetic cleanup tooling: cleanup-success` and `cleanup-failure`; failure retains root/journal. `cleanup refuses an unscoped directory` protects unrelated paths |
| No local Docker provisioning | `provisioning refuses a non-GitHub-hosted environment before installation` |
| Nine isolation/resource/cancellation properties and broker recovery | Existing `tests/sandbox/feasibility.py` and 14 `broker.test.ts` integration cases remain mandatory; native Linux execution pending |
| Preserve Core Engine and dependency correction | Existing CI checks job unchanged; local unit and dependency tests pass; real PostgreSQL rerun blocked as recorded above |

No installed Linux runtime versions, successful registry transactions, or Linux cleanup results are claimed by synthetic tooling tests. No current macOS security baseline is claimed. A successful future Linux run should be recorded as **Linux-verified; macOS validation outstanding**, until the separate macOS requirement passes.

## Hosted containerd version-format correction — 2026-10-21

Draft PR #3 run [39576316285](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39576316285) passed the Core Engine job. The sandbox job installed the exact reviewed packages, passed package integrity, active executable provenance and runc checks, then failed at the containerd CLI substring assertion. Its unconditional cleanup passed; image preparation and sandbox execution did not run.

The failed log does **not** contain the literal `containerd --version` output: `check_output` captured it without printing. It must not be represented as an observed CLI line. Independent inspection downloaded the identical official package without installation or execution and matched its SHA-256 to the CI archive:

```text
f811ab57d1f4bb0cce19df7d526da8c711d8ebea0447cc83da1999188e664122
```

Embedded linker metadata sets `version.Version=v2.4.2`, `version.Package=containerd`, and `version.Revision=b7a25261e029d68978bbf290df0a62fc819b3c51`. The [upstream v2.4.2 VersionPrinter](https://github.com/containerd/containerd/blob/v2.4.2/cmd/containerd/command/main.go) prints name, package, version and revision. Together they establish this expected line, pending literal capture in the corrected hosted run:

```text
containerd containerd v2.4.2 b7a25261e029d68978bbf290df0a62fc819b3c51
```

The old `' 2.4.2 '` substring rejects the official `v2.4.2` token. The correction prints the captured line as JSON and uses a full-match parser for the verified Docker package/upstream package formats, exact reviewed version, and a 40-character hexadecimal revision. Unknown packages, extra text, missing fields, dirty/prerelease builds and other versions fail closed. Package pins, provenance, integrity and isolation checks are unchanged.

Adjacent checks were reviewed: runc's exact first-line comparison passed in the failed job; Debian versions use exact equality; Docker API component versions and daemon GoVersion use exact equality. The containerd Go build-header check is separate and unchanged. Checks after the failing CLI assertion still need hosted evidence; no speculative version normalization was added elsewhere.

Local correction checks: lint, strict typecheck, build and `git diff --check` exit 0; unit tests 65/65; dependency tests 7/7; sandbox tooling tests 24/24, including 15 new valid/invalid parser fixtures. Native Linux provisioning and sandbox execution cannot be validated on this macOS host. Earlier local PostgreSQL unavailability and macOS ARM64 secure-validation limitations remain unchanged. This correction does not establish Linux verification or full AF-007 completion.


## Approved component-specific Go baseline correction — 2026-10-21

Run [39577933614](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39577933614) confirmed the containerd CLI parser fix and literal version output, then stopped at the separate Go build gate. Core Engine checks and failure-path cleanup passed. The identical official package's embedded build version is Go 1.27.3; the owner approved that exact containerd build after reviewing the Go crypto/x509 fix shared with Go 1.26.10. See SANDBOX.md for source links and the exact component matrix.

The correction adds strict embedded-header parsing, exact component/build matching and active executable file-identity verification. No package versions, migrations, provider contracts, dependency patches, TLS settings, image digests or mandatory CI steps change. Adjacent CLI and Docker API comparisons remain exact; no automatic normalization or future-version acceptance was introduced.

Local verification: `npm run lint`, `npm run typecheck`, `npm run build`, and dependency verification exit 0; `npm test` passes 65/65, `npm run test:deps` passes 7/7, and `npm run test:sandbox-tools` passes 45/45, all with zero failures/skips/cancellations. The tooling suite includes 21 new exact-combination and malformed/missing build-header cases. Native Ubuntu preflight and resource tests require the hosted run; macOS ARM64 remains outstanding. Historical results above are retained as checkpoints.

## Docker API containerd representation correction — 2026-10-21

Run [39578840617](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39578840617) confirmed the reviewed embedded Go 1.27.3 build, then failed because Docker's component map contained `containerd: v2.4.2`. Both Python CI preflight and TypeScript broker preflight now accept exactly `2.4.2` or `v2.4.2`. This is an explicit representation allowlist, not generic prefix stripping or a version-range policy. Prereleases, suffixes, whitespace, malformed and different versions fail. Regression fixtures reproduce the observed Engine 29.9.2/containerd v2.4.2/runc 1.5.2/docker-init 0.19.0 map.

Adjacent Engine, runc, package and component-specific Go checks remain unchanged. The CLI version parser already verifies its separately reviewed prefixed format. No TLS, registry, image digest, filesystem or isolation assertion is removed or relaxed.

Local checks: lint, strict typecheck, build, dependency verification and whitespace checks passed; unit tests 65/65, dependency tests 7/7, tooling tests 62/62. The expanded TypeScript preflight case and 17 new Python API cases cover acceptance and rejection. The local Docker socket is absent, so Docker-backed database and sandbox suites cannot be rerun locally. Hosted verification remains required; macOS ARM64 remains outstanding.

## Approved AppArmor capability and confinement correction — 2026-10-21

Diagnostic run [39693978243](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39693978243)
reported `["name=apparmor,profile=default","name=seccomp,profile=builtin","name=cgroupns"]`,
kernel AppArmor `Y`, an active LSM list containing AppArmor, and
`docker-default (enforce)` loaded. The earlier exact bare-name comparison was
incorrect. No runner security configuration is changed by this correction.

Acceptance mapping:

| Requirement | Maintained evidence |
| --- | --- |
| Exact default metadata, reject absent/duplicate/conflicting/custom/malformed | `tests/sandbox-tools.test.mjs` AppArmor metadata parser cases; `tests/sandbox-security.test.ts` runtime metadata test |
| Enabled kernel, active LSM, enforce-mode loaded profile, no template/config override | Mandatory `verify-sandbox-linux.py`; tooling AppArmor host evidence cases |
| Explicit container profile and reject unexpected/missing inspected profile | `docker-runtime.ts` exec gate; unit test refusing exec creation |
| Fail before invoking project code without effective confinement | Trusted exec wrapper; synthetic ineffective-confinement unit test |
| Actual project-process confinement | First `tests/sandbox/broker.test.ts` integration test reads process attribute inside project command |
| Actual native isolation and resource controls | First feasibility property checks inspected profile and process attribute; all nine properties remain mandatory |
| Cleanup on failure, no suppressed required checks | Existing unconditional CI cleanup and workflow regression tests, unchanged |

Local verification uses Node 24.22.0 and npm 11.9.0. Lint, strict typecheck,
build, dependency verification, and whitespace checks pass. Dependency tests:
7/7; unit tests: 69/69; sandbox tooling: 83/83. Zero failures, skips, or
cancellations. Native Linux preflight, immutable image preparation, 14 broker
integration tests, nine feasibility properties, and PostgreSQL suites require
hosted verification; no local Docker runtime was started. Hosted outcomes must
be reported separately. macOS ARM64 validation remains outstanding.

## Approved independent image identity correction — 2026-10-21

Diagnostic run [39699029294](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39699029294)
established absent local Descriptor fields, correct linux/amd64, the exact locked
index RepoDigest, four local layers, and a registry child configuration digest
equal to local image ID
`sha256:1be4eb165f7f86db2f8daadef8aada18637b5da6781c7191f4d359021ee7076a`.
Inspection by child reference was unavailable locally. The previous gate failed
on missing optional metadata, not a demonstrated wrong download.

The correction uses the reviewed Docker CLI's original-payload digest checks,
with a fresh private configuration to exclude manifest-cache substitution.
See SANDBOX.md for source attribution and the complete validation model.
No image locks, package pins, TLS settings, Core Engine, schema or provider
contracts change. Offline mode cannot pass the fresh identity gate.

| Acceptance requirement | Maintained test/evidence |
| --- | --- |
| Observed AMD64 chain; absent/valid/conflicting optional descriptors | immutable identity chain cases in tests/sandbox-tools.test.mjs |
| Index, child, configuration, repository, OS and architecture relationships | wrong/crossed identity cases |
| OCI schema/media types; missing/duplicate platform; malformed and missing content | schema, descriptor, layer and missing-evidence cases |
| Registry failure; fresh private config cleanup; no container execution | fresh image identity verification fixtures |
| Offline cannot authorize or access registry | offline metadata test |
| Actual secure image preparation before project execution | mandatory sandbox:image step followed by sandbox suite in hosted CI |
| AppArmor process confinement and cleanup | existing broker integration and nine-property feasibility suite; unconditional CI cleanup |

Local commands: npm run lint, npm run typecheck, npm run build, npm test,
npm run test:deps, npm run test:sandbox-tools, git diff --check.
Hosted execution results are reported separately; historical offline evidence is
preserved and macOS ARM64 remains outstanding.

Local results for this correction: lint, strict typecheck, build, dependency
verification and whitespace checks passed; unit tests 69/69, dependency tests
7/7, tooling tests 121/121, with zero failures, skips or cancellations.

## Hosted Linux AMD64 verification — 2026-10-22 UTC

Commit `2ae71bda2d8c03f1371532493e62fc2e313b1398` passed both jobs in
[run 39711100025](https://github.com/crisdanrodriguez/agentic-factory/actions/runs/39711100025).
The complete security preflight passed on Engine 29.9.2, containerd v2.4.2 and
runc 1.5.2 with the unchanged reviewed packages and Go builds. Image identity
verification passed before any sandbox test executed: locked index and AMD64
manifest, configuration
`sha256:1be4eb165f7f86db2f8daadef8aada18637b5da6781c7191f4d359021ee7076a`,
linux/amd64, and four layers.

Exact results: dependency tests 7/7; unit tests 69/69; tooling tests 121/121;
PostgreSQL compatibility four assertions; state 5/5; queue/recovery 8/8;
simulations 24/24; broker integration 14/14; feasibility properties 9/9.
All executed suites had zero failures and skips. Lint, strict typecheck, build,
migrations, role setup, and both profile validation demonstrations passed.

The first broker integration case verified AppArmor inside the actual project
process. Feasibility independently reported `docker-default (enforce)` process
confinement, tested resource ceilings/enforcement, network denial, child-tree
cancellation, interruption/recovery and private IPC. Adversarial output and
cleanup-pending/reconciliation tests passed. Logs confirmed no checkpoint
containers remained; the unconditional cleanup step confirmed registered
containers and temporary directory/socket resources absent.

This establishes Linux AMD64 evidence for the reviewed synthetic tests only.
It does not prove general hostile-workload safety or cross-platform completion.
macOS ARM64 remains outstanding; previous offline records remain preliminary.
No merge, deployment, real provider integration, or AF-023 work is authorized
by this result.
