# Adopt GroundControl

GroundControl is a self-hosted, single-tenant control plane for operating Docker Compose applications on infrastructure you own. It is designed for founders and lean teams that want agents such as ChatGPT to inspect and operate deployments without receiving SSH keys or unrestricted shell access.

## Choose your starting point

### Evaluate privately

Use this when you want to inspect the product before creating a public management endpoint.

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --json
```

The installer binds GroundControl to loopback, returns a short-lived one-time claim URL, and leaves publication as a separate operator decision.

### Install interactively

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash
```

For a remote VPS, create the SSH tunnel printed by the installer, open the local claim URL, and create the first administrator.

## The first 15 minutes

1. Run the installer on a supported Linux VPS with Docker or permission to install it.
2. Claim the instance through the loopback URL.
3. Keep it private or publish it through the supported Caddy/Cloudflare flow.
4. Confirm the local host was automatically enrolled.
5. Connect one repository-backed Docker Compose application.
6. Record its exact repository, branch, deployed revision, Compose file and public URL.
7. Confirm runtime and public health in GroundControl.
8. Connect ChatGPT or another MCP client through OAuth.
9. Grant one deployment and only the capabilities needed for the trial.
10. Ask the agent to list, inspect and check health before permitting a redeploy.

## A safe pilot

Start with one stateless or easily recoverable application.

Recommended grant:

- `deployment:read`
- `deployment:health`
- `deployment:logs`
- `operation:read`
- `deployment:redeploy` only after read-only checks succeed

Do not begin with database mutation, volume deletion, firewall changes, arbitrary terminal access, or production secrets.

## A useful ChatGPT acceptance conversation

Use outcome-oriented requests:

```text
List the deployments available to you.

Inspect <deployment> and report its repository, deployed revision,
container health and public endpoint health.

Redeploy <deployment>. Return the operation ID, monitor it until
GroundControl finishes verification, and report the evidence.
```

Expected behaviour:

- ChatGPT sees only deployments included in its grant.
- GroundControl—not the model—checks policy and executes typed operations.
- The chat receives an operation ID rather than holding an SSH session open.
- The operation continues if the chat disconnects.
- Final reporting includes runtime and customer-facing verification evidence.

## Merge-triggered deployment

Enable this only after the manual redeploy path is proven.

Required deployment identity:

- repository
- allowed branch
- exact deployed revision
- repository-owned Compose file
- synchronized environment contract
- public verification URL
- previous known-good artifact or revision
- deployment-specific autopilot policy

A signed, allowed push creates a durable `deployment.source.deploy` operation. Existing CI or an approved isolated builder produces the artifact; the production VPS is not the default builder.

## Upgrade safely

Preview first:

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --preview --version latest --json
```

Then upgrade:

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --upgrade --version latest --json
```

The upgrade contract identifies persistent storage, resolves the target image, backs up database and configuration state, starts the digest-pinned image, checks health, and restores the previous state if acceptance fails.

## Uninstall without deleting data

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/install \
  | sudo bash -s -- --uninstall --json
```

The default uninstall removes the runtime while preserving the database volume and install directory.

## Current product state

### Live

- Single-tenant self-hosted control plane
- Docker, Compose, proxy, deployment, log, metric and terminal operations
- Agent-assisted install and one-time ownership claim
- MCP/OAuth capability grants
- Scoped deployment inspection, health, logs and durable redeploy
- Secret-safe named configuration checks
- Guarded upgrade with backup, verification and automatic rollback
- Data-preserving uninstall
- Deployment-scoped merge-triggered proof on RentAWeekend

### Early access

- Daytona reproduction for eligible code/configuration failures
- Guarded merge-triggered autopilot beyond the proven deployment
- Provider-dependent public publishing paths across varied VPS environments

## Production checklist

- [ ] Backups exist outside the VPS.
- [ ] GroundControl binds to loopback unless intentionally published.
- [ ] HTTPS protects any public management endpoint.
- [ ] Every agent grant is deployment- and capability-scoped.
- [ ] Deployed repository revision is recorded.
- [ ] Builds occur away from the production VPS.
- [ ] Health checks cover all declared Compose services.
- [ ] A meaningful public verification URL is configured.
- [ ] A known-good rollback artifact is retained.
- [ ] One harmless redeploy proof has passed.
- [ ] Durable operation evidence is reviewable.

## Evidence

- [Clean-host distribution acceptance](./acceptance/distribution-2026-09-21.md)
- [Deployment automation and Daytona](./DEPLOYMENT-AUTOMATION-AND-DAYTONA.md)
- [Agent-assisted distribution](./agent-assisted-distribution.md)
