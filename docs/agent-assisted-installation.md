# Agent-assisted installation

GroundControl's canonical installer is designed to be run **on the authorized target host**. An agent may perform the mechanical installation, but a fresh instance remains unclaimed until a human completes the one-time claim.

## Why the claim boundary exists

An installer that silently creates an administrator account gives the installer permanent control-plane authority. GroundControl instead separates:

1. host authorization, which belongs to the user/agent relationship outside GC;
2. software installation, which an agent can automate;
3. control-plane ownership, which is established once by the human claim.

An agent with root access to a VPS is inherently powerful, but GroundControl does not convert that temporary install authority into a hidden GC administrator credential.

## Canonical command

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install | sudo bash
```

Agent mode:

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --json
```

For a download/verify/run flow:

```bash
curl -fsSLO https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install
curl -fsSLO https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install.sha256
sha256sum -c install.sha256
sudo bash install --json
```

CI verifies `scripts/install.sha256` on every change to keep the published checksum in sync.

Progress is written to stderr in JSON mode. stdout contains one final JSON object.

## Fresh-install result

Example shape:

```json
{
  "product": "groundcontrol",
  "stage": "claim_required",
  "instanceId": "gc_...",
  "claimPath": "/claim#token=gc_claim_...",
  "claimToken": "gc_claim_...",
  "expiresAt": "2026-09-18T14:00:00.000Z",
  "hostPort": 3003,
  "checks": {
    "docker": "ready",
    "container": "ready",
    "health": "ready"
  },
  "next": "human_claim"
}
```

The raw token exists only in installer output/browser handoff. GroundControl stores its SHA-256 digest. Creating a new outstanding claim revokes the previous one.

## Human claim

GroundControl binds the installer deployment to loopback. Before HTTPS is configured, use an SSH tunnel:

```bash
ssh -L 3003:127.0.0.1:3003 root@SERVER
```

Open the returned claim path on `http://127.0.0.1:3003`. The token is transported in the URL fragment, which is not sent in the initial HTTP request; the claim page reads it client-side and immediately removes it from the address bar.

The human chooses the first administrator username/password. Successful claim:

- atomically consumes the claim;
- creates the first admin;
- revokes every other outstanding claim;
- records an audit event;
- signs the new administrator in;
- continues to onboarding.

## Pre-claim restrictions

An active installation claim blocks the legacy `/setup` administrator-creation endpoint. The authenticated product, terminal, connectors and MCP write surface remain unavailable because no user session exists.

Legacy/manual development installs with no generated claim may still use `/setup` for compatibility.

## Idempotency

Running the canonical installer against a healthy existing instance does not update the image or rewrite Compose by default.

- already claimed → `already_claimed`, no change;
- healthy but unclaimed → rotate/return a fresh claim, no image change;
- explicit `--upgrade` → run the guarded upgrade transaction.

## Upgrade preview

Before changing a running instance:

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --preview --version <tag-or-short-sha> --json
```

Preview checks the current container, persistent DB mount, target image reachability and available disk without changing the running instance.

## Guarded upgrade

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --upgrade --version <tag-or-short-sha> --json
```

GroundControl:

1. pulls the requested image while the current instance is still running;
2. resolves the pulled tag to a registry digest when available;
3. stops the current container briefly for a consistent SQLite volume backup;
4. saves the previous Compose/env state;
5. starts the digest-pinned image;
6. waits for the health check after migrations;
7. restores the DB + previous image/config automatically when the new instance fails health;
8. records `result.json` and failed-upgrade logs in the backup directory.

Machine-readable outcomes include:

- `upgrade_complete`
- `upgrade_rolled_back`
- `rollback_failed`

The last three backup directories are retained by default.

## Data-preserving uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --uninstall --json
```

This removes the runtime container/bridge processes but preserves the GroundControl DB volume and install directory for recovery.

## Versioning

`--version TAG` selects a release/short-SHA tag. The installer resolves that tag to the pulled registry digest when possible and writes the immutable digest into the generated Compose file.

## Security properties

- no generated admin password;
- no SSH private key accepted by the canonical on-host installer;
- JWT/encryption keys generated on-host and stored mode 0600;
- GC binds to `127.0.0.1` until the operator configures a reverse proxy/tunnel;
- claim token is random, short-lived, hashed at rest, single-use;
- no bootstrap credential survives successful claim.

## Post-claim distribution

After claim, onboarding can keep the instance private or publish it through direct Caddy HTTPS, a named Cloudflare Tunnel, or a temporary outbound HTTPS bridge. GroundControl then verifies host execution, PTY, MCP discovery, OAuth metadata, persistent storage, consumed claim state and public HTTPS when configured.
