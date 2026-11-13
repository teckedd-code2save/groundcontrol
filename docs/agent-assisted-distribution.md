# Agent-assisted GroundControl distribution

GroundControl is single-tenant. Each installation owns its own control plane, credentials and operator login.

## Start from the visitor’s computer

`scripts/start` asks whether to use local Docker or a remote Linux server and prints a reachable claim/login link. Remote mode calls the canonical installer and holds an SSH tunnel open. Local mode runs a desktop-capable image with a persistent database and private port. [Commands and platform limits](./start-from-your-computer.md).

## Canonical server flow

```
authorized VPS
  -> scripts/install
  -> local GroundControl at 127.0.0.1
  -> local host auto-enrolled
  -> one-time human claim
  -> publish or keep private
  -> post-install verification
  -> connect ChatGPT / MCP client through OAuth
```

The installing agent performs mechanical work. It does not create or retain the permanent administrator credential.

## First managed server

When `scripts/install` runs on a VPS, the GroundControl container receives the Docker socket and the entrypoint creates an active `isLocal=true` VPS target when no target exists.

That means the installation is already connected to the machine it runs on. There is no reason to paste that server's SSH private key back into GroundControl.

Additional servers can later be added deliberately through Connections/Onboarding using SSH.

## Bootstrap URL

The installer returns a loopback HTTP URL and a short-lived one-time claim URL. HTTP is a local/bootstrap transport only.

Do not expose `http://PUBLIC_IP:3003` as the normal management plane.

## Publishing after claim

### Free server address + Caddy

After claim, **Set up free server address** previews a hostname without changing the host. GroundControl uses `GC_PROVIDER_HOSTNAME` only when the operator has explicitly configured it and its DNS matches this server. Otherwise it uses `<public-ipv4>.sslip.io`. No purchased domain or Cloudflare account is needed.

The address is tied to the allocated public IP/provider hostname, not a permanent GroundControl-owned identity. If the IP is released or reassigned, stop using that address and reconnect clients. Shared DNS availability and certificate issuance depend on third parties.

**Set up HTTPS** is an explicit action. It installs/reuses Caddy, keeps GC's application port loopback-only, and verifies HTTPS and the instance identity. Ports 80 and 443 must already be reachable through both cloud and host firewalls. GroundControl does not open them. A different or unidentified service on those ports blocks automatic setup rather than being replaced; configure that existing proxy or deliberately free the ports.

### Optional own domain

A custom hostname is optional. Direct DNS + Caddy needs no Cloudflare account. All A records must point to this server; any AAAA records must match its global IPv6 addresses. Resolver failures are reported as failed checks, not instructions to change DNS. GroundControl never deletes conflicting DNS records automatically.

Custom-domain setup adds another address alongside the established server address. The original canonical OAuth/MCP identity remains the client endpoint; adding an alias is not an issuer migration. Publication verification checks the same claimed instance and canonical metadata before reporting the new address ready. It does not replace a real OAuth authorization/token exchange or authenticated MCP/streaming acceptance test.

### Cloudflare Tunnel

Use when the domain is on Cloudflare or the operator prefers a private origin.

GroundControl:

1. verifies/saves the Cloudflare API token encrypted at rest;
2. creates/reuses a named management-plane tunnel;
3. places cloudflared on the GroundControl Docker network;
4. routes to `groundcontrol-web:3000` internally;
5. creates/updates the CNAME;
6. verifies the resulting HTTPS URL.

The management port remains loopback-only on the host.

### Transition and recovery limits

Publishing is serialized within the canonical single web process, not across multiple independent replicas. Existing proxy routes are not silently replaced. Interrupted Caddy setup may leave a uniquely named candidate site in `/etc/caddy/groundcontrol-sites/`; retry refuses to overwrite it. Inspect the candidate and current canonical route before removing or repairing only that candidate.

If verification fails after saving the canonical configuration but before completing the handoff, GroundControl attempts to restore the prior identity settings atomically. Candidate routes may remain for inspected recovery. The temporary connector and previous named connector are retained through the response to avoid cutting off the browser handoff. The temporary URL remains an additional public, account-protected route, not a private connection; clean it up explicitly only after checking the primary address. Keep available access paths while inspecting and retrying verification; do not reset the instance. Automatic public-IP/issuer migration and removal of an established canonical address are not provided by this flow. Existing private installations remain supported.

### Temporary HTTPS bridge

When no domain exists yet, GroundControl can start an outbound Cloudflare Quick Tunnel and return a `trycloudflare.com` URL.

This is bootstrap convenience, not durable instance identity. The hostname may change after restart.

### Private

The operator can keep GroundControl local/SSH-only. Host/runtime verification still runs, but an external MCP client cannot connect until a reachable HTTPS endpoint exists.

## Verification contract

After publishing, GroundControl records evidence for:

- container health;
- persistent `/app/prisma` volume;
- strict host execution;
- PTY relay;
- MCP tool discovery;
- OAuth protected-resource metadata;
- consumed claim boundary / no active bootstrap claim;
- public HTTPS when configured.

The result is persisted and returned as structured data instead of shell-log soup.

## Security invariants

- no default admin password;
- no permanent bootstrap credential;
- claim tokens are short-lived, hashed and single-use;
- management port remains loopback-only;
- public management uses HTTPS;
- publishing requires authenticated admin access;
- external agents receive MCP/OAuth grants, not operator sessions;
- provider/tunnel credentials remain encrypted at rest.


## Upgrade and recovery contract

The canonical installer also owns upgrades. Agents should call `--preview` before `--upgrade`.

A guarded upgrade:

1. identifies the current image and persistent `/app/prisma` storage;
2. pulls and resolves the requested image to a digest;
3. quiesces the app and backs up SQLite plus Compose/env state;
4. starts the new digest-pinned image;
5. treats the container health check as the migration/startup acceptance gate;
6. restores the previous DB, image and configuration if the gate fails;
7. returns structured evidence.

An automatic rollback that restores health exits non-zero because the requested upgrade still failed. Agents should report the rollback as successful recovery, not as a successful upgrade.

`--uninstall` is data-preserving by default. It removes the runtime but leaves the database volume and install directory available for recovery.


## Clean-host acceptance

`.github/workflows/distribution-acceptance.yml` provides a disposable-host acceptance run after each image build and on manual dispatch. A separate desktop job proves anonymous image download, launcher setup, private verification, terminal access and reconnect. Only successful server and desktop acceptance promotes the current main image to `latest`.

The workflow proves the canonical distribution contract on a fresh GitHub-hosted Linux machine:

1. verifies the published installer checksum;
2. installs the selected GHCR image through `scripts/install --json`;
3. proves the management port is loopback-only and that the canonical install does not mount `/root/.ssh`;
4. completes the real one-time claim API and creates the first administrator;
5. runs GroundControl's private-mode post-install verification;
6. checks PTY, host execution, MCP discovery, OAuth metadata, persistent storage and claim consumption;
7. reruns the installer to prove idempotency;
8. previews and performs a guarded same-image upgrade, including DB backup evidence and digest-pinned runtime;
9. proves the operator session survives the upgrade;
10. runs the data-preserving uninstall and verifies the database volume remains.

Only redacted evidence is uploaded. Claim tokens and claim URLs are removed before artifacts are created.

External HTTPS/Cloudflare paths remain provider-dependent integration checks; the deterministic clean-host job validates all local trust boundaries without relying on a third-party tunnel during CI.

## Publishing a release without upgrading the operator instance

A merge to main publishes a revision-tagged image. Distribution Acceptance checks the server and desktop paths, then promotes that same image to `latest` if main still points to the tested revision. The production VPS job does not run on a push. Its explicit manual `deploy_vps` input defaults to false; an operator upgrade requires its own backup and migration rehearsal. Publishing an image does not authorize updating existing instances.

Desktop setup is not an upgrade command. Server upgrades continue to use `scripts/install --preview` and `--upgrade`, with the existing backup and rollback contract.
