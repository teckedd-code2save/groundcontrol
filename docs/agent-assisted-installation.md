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
- explicit `--upgrade` → refresh the requested image/version.

## Versioning

`--version TAG` pins the container tag/short SHA. Production distribution should prefer published release tags or immutable SHA tags over `latest`.

## Security properties

- no generated admin password;
- no SSH private key accepted by the canonical on-host installer;
- JWT/encryption keys generated on-host and stored mode 0600;
- GC binds to `127.0.0.1` until the operator configures a reverse proxy/tunnel;
- claim token is random, short-lived, hashed at rest, single-use;
- no bootstrap credential survives successful claim.

## Next distribution slice

The remaining #93 work is post-claim automation: supported HTTPS/Caddy or outbound bridge setup, structured host-execution/PTY/MCP/OAuth verification, release-channel upgrades and rollback evidence.
