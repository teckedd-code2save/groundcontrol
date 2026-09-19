# Agent-assisted GroundControl distribution

GroundControl is single-tenant. Each installation owns its own control plane, credentials and operator login.

## Canonical flow

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

### Direct domain + Caddy

Use when the operator owns a hostname with any DNS provider.

GroundControl:

1. determines the VPS public IPv4;
2. checks the hostname resolves to that address;
3. returns the exact required A record if DNS is not ready;
4. installs/reuses Caddy on supported Linux hosts;
5. proxies the GroundControl loopback port;
6. obtains HTTPS through Caddy;
7. verifies the public OAuth endpoint.

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
