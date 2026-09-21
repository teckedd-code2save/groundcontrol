# Distribution acceptance — 21 September 2026

> Result: passed on a disposable GitHub-hosted Linux machine against GroundControl revision `e27dddec3bdf5944de7ca7317b1bbbf32b203953`.

This record contains the redacted evidence for the first launch-candidate distribution acceptance run. It proves the installer contract on a clean host; it does not claim that every provider-specific public HTTPS path has been exercised.

## Run

- Workflow: [Distribution Acceptance #7](https://github.com/teckedd-code2save/groundcontrol/actions/runs/35617805067)
- Trigger: manual `workflow_dispatch`
- Image selector: `latest`
- Job: `clean-host`
- Result: success
- Evidence artifact: `distribution-acceptance-e27dddec3bdf5944de7ca7317b1bbbf32b203953`
- Artifact digest: `sha256:3d753f54fb31c8abfd314eb840b023c4372516df2944e94df0a5c3e88cfaffa9`

## What passed

| Contract | Evidence |
|---|---|
| Installer integrity | Shell syntax and published checksum passed |
| Immutable runtime | Installer resolved `latest` to image digest `sha256:50b1186f7eb95d87eacf71f8cf35172d48c7f6bca8e20d549c173c73f411ff0b` |
| Private-by-default bootstrap | Bound to `127.0.0.1:3003` and returned `claim_required` |
| Container readiness | Docker, container and health checks returned `ready` |
| Human ownership boundary | One-time claim created the first admin; no active claim remained afterward |
| Idempotency | Rerunning the installer returned `already_claimed` with `changed: false` |
| Persistent storage | Database used a persistent Docker volume |
| Host execution | Strict host execution plane returned `ready` |
| PTY | PTY relay returned `ready` with `/bin/sh` |
| Agent discovery | MCP discovery exposed GroundControl deployment tools |
| OAuth discovery | Protected-resource metadata returned `ready` |
| Upgrade preview | Container, storage and target image checks returned `ready` |
| Guarded upgrade | SQLite/Compose state was backed up; the digest-pinned workload returned healthy |
| Session continuity | The claimed operator state survived the upgrade |
| Uninstall | Runtime was removed with `dataPreserved: true` |

## Deliberate scope

The acceptance instance stayed private, so `publicHttps` was correctly reported as `skipped`. Direct-domain Caddy and Cloudflare Tunnel publishing remain provider-dependent integration checks and must not be represented as part of this clean-host result.

## Launch claim this evidence supports

> GroundControl can be installed on a clean Linux host, claimed by its owner, verified for agent use, safely upgraded with a recoverable backup, rerun idempotently, and uninstalled without deleting its data.

Do not shorten this to “zero-risk installation” or imply that every VPS distribution, DNS provider, or public publishing path is already proven.
