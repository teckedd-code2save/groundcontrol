# Agent-native access

GroundControl exposes a narrow remote MCP surface at `/mcp`. External agents receive typed infrastructure capabilities, not shell access or infrastructure credentials.

## Connect

1. Add `https://<your-groundcontrol>/mcp` to a compatible remote MCP client.
2. The client discovers GroundControl OAuth through RFC 9728 protected-resource metadata.
3. GroundControl authenticates the operator, requests OAuth consent, and lets the operator choose the exact deployments the client may see.
4. The client receives short-lived bearer access plus a rotating refresh token when `offline_access` is granted.

OAuth uses Authorization Code + S256 PKCE. Client ID Metadata Documents are supported; dynamic client registration remains available for compatibility.

## Initial capability surface

Read:
- `deployment.list`
- `deployment.inspect`
- `deployment.logs`
- `deployment.health`
- `operation.get`

Write:
- `deployment.redeploy`

No MCP tool exposes SSH credentials, provider secrets, raw terminal access, or generic command execution.

## Durable mutations

`deployment.redeploy` requires an idempotency key and returns an `AgentOperation` immediately.

Typical lifecycle:

```
pending -> running -> verifying -> success
                   \-> failed
running + GC restart -> uncertain
```

Self-hosted detached redeploys survive the calling agent disconnecting and are reconciled from GroundControl's deployment evidence. A GroundControl restart during a non-detached mutation is not replayed automatically because the external side effect may already have occurred; the operation becomes `uncertain`.

## Revocation

The Agents workspace lists authorized MCP clients and their exact workload grants. Revoking a grant:
- revokes current access/refresh tokens;
- cancels queued operations that have not started;
- prevents future MCP reads/writes.

An already-running mutation is not force-killed solely because a grant is revoked; GroundControl continues recording its outcome so the control plane does not lose operational evidence.

## Current acceptance milestone

A release is agent-ready when a remote client can:

1. connect to GroundControl using OAuth;
2. inspect an approved deployment;
3. check its health;
4. request a redeploy;
5. receive an operation id immediately;
6. disconnect;
7. reconnect using refresh access;
8. read the operation's verified success/failure evidence;
9. remain unable to see or mutate deployments that were not granted.
