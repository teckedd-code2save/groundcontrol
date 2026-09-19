<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## GroundControl conventions (maintain these)

- **Remote exec**: use `execOnVps()` and `shQuote()` from `src/lib/vps.ts` for every command run on a managed host. Prefer POSIX sh / BusyBox syntax; avoid bashisms.
- **Tabs**: the main surfaces use tabs now:
  - `/settings` tabs: `connections`, `layout`, `ai`, `security`, `cloudflare`, `alerts`, `deploy-targets`, `cloud-accounts`, `infrastructure`
  - `/services` tabs: `containers`, `proxy`, `projects`, `deployments`, `cloudflare`, `bootstrap`
- **Onboarding**: `/onboarding` is the first-run flow. Preserve its auto-detect and test-connection behavior.
- **Cloudflare**: account tokens are encrypted at rest (`encryptCloudflareToken` / `decryptCloudflareToken`). Active account is the one with `isActive=true`.
- **Alert rules**: evaluated by `/api/alert-rules/evaluate`. `AlertScheduler` in `layout.tsx` calls it every 60s. Keep evaluation idempotent and deduplicated.
- **Terminal**: `/terminal` is a persistent xterm + PTY session over authenticated Socket.IO. Do not reintroduce browser-side command parsing, autocomplete, or per-command HTTP execution. Tab/control keys belong to the shell.
- **Topology**: uses XYFlow group nodes for projects/sites. `TopologyFlow` wraps groups around their children after dagre layout.
- **Sidebar**: collapsible via `SidebarContext`. Terminal and AI chat fullscreen modes collapse it and use `z-[70]` to overlay it.

# GroundControl Agent Notes

## Product conventions

- **Onboarding wizard**: First-time users with no `VpsConfig` are redirected to `/onboarding`. The wizard walks through local vs remote mode, SSH credentials, connection test, server auto-detection (`src/lib/server-probe.ts`), and saving + activating the VPS.
- **Navigation**: Sidebar has 6 items: Dashboard, Topology, Services, Terminal, Alerts, Settings. Containers / Reverse Proxy / Projects are combined under `/services` (original routes still work for bookmarks).
- **Services page**: `src/app/services/page.tsx` renders `ContainersPanel`, `ProxyPanel`, `ProjectsPanel`, `DeploymentsPanel`, `CloudflarePanel`, and `BootstrapPanel` in tabs.
- **Settings tabs**: Connections, Server Layout, AI, Security, Cloudflare, Alerts, Deploy Targets, Cloud Accounts, Infrastructure. Server Layout supports auto-detect from the active VPS. AI tab includes provider + model selection.
- **Deployment targets**: Projects deploy through pluggable adapters (`compose`, `static`, `k3s`, `cloudrun`, `terraform`) defined in `src/lib/deploy/targets/`. Target selection lives in the Projects panel; target configuration lives in Settings → Deploy Targets.
- **Cloud accounts**: Encrypted GCP/AWS/Azure credentials are managed in Settings → Cloud Accounts and consumed by cloud adapters.
- **Terraform control plane**: Infrastructure stacks are managed in Settings → Infrastructure. Stacks generate HCL, run `plan`/`apply`/`destroy` on the active VPS, and can feed outputs back into the deploy pipeline.
- **Agent access**: external agents connect through `/mcp` using OAuth Authorization Code + S256 PKCE. Grants are scoped to explicit deployments and capabilities. Never expose SSH keys, provider secrets, or a generic shell/exec MCP tool. Mutations return durable `AgentOperation` handles.
- **AI alert synthesis**: `/api/alerts/synthesize` returns `{ summary, rootCauses, actions }` and is shown on the dashboard; the Investigate button opens the AI chat widget with a pre-filled query.

## Code conventions

- Server logic lives in `src/lib/`. All remote/host operations go through `src/lib/vps.ts` (`execOnVps`, `shQuote`).
- API routes must call `requireAuth(req)` and remain thin.
- `src/lib/server-probe.ts` runs POSIX sh / BusyBox-compatible commands for auto-detection.


## External agent contract

- MCP follows the stateless 2026-07-28 shape while retaining a small compatibility response for older `initialize` clients. Keep `Mcp-Method` / `Mcp-Name` validation.
- OAuth discovery is exposed through `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Prefer Client ID Metadata Documents; dynamic registration remains a compatibility fallback.
- Access tokens and refresh tokens are opaque and stored only as hashes. Refresh tokens rotate. Revoking a grant revokes live tokens immediately.
- Agent grants are resource-scoped. Every deployment tool must resolve the requested deployment through the grant's approved `EnrolledDeployment` IDs before reading or mutating it.
- External write operations must be idempotent and durable. Do not replay a mutation after an uncertain worker interruption; surface `uncertain` and require reconciliation/inspection.
- The first MCP surface is intentionally narrow: `deployment.list`, `deployment.inspect`, `deployment.logs`, `deployment.health`, `deployment.config.check`, `deployment.redeploy`, and `operation.get`. `deployment.config.check` is exact-key metadata only: never return secret values or bulk-list configuration names.


## Distribution and instance publishing

- The canonical `scripts/install` runs **on the authorized GroundControl host** and binds the web container to `127.0.0.1` only.
- `docker-entrypoint.sh` / `ensure-local-vps.cjs` automatically enroll that host as the first active local VPS target. Fresh canonical installs must not ask the operator to SSH back into the same machine.
- Fresh installs are unclaimed. The human claim is the ownership boundary; instance publishing is authenticated and happens only after claim.
- The management plane must not be published by opening port 3003 globally.
- Supported publish modes are:
  - direct domain + Caddy after DNS resolves to the host,
  - named Cloudflare Tunnel + DNS for a private origin,
  - temporary outbound quick tunnel for bootstrap/no-domain use,
  - private/local-only.
- Temporary `trycloudflare.com` URLs are explicitly non-durable and must never be presented as permanent instance identity.
- Public management URLs must use HTTPS and become the OAuth/MCP base for that instance.
- `src/lib/instance-publish.ts` owns publishing mechanics and post-install verification. Keep onboarding thin.
- Post-install verification covers container health, persistent DB volume, host execution, PTY relay, MCP discovery, OAuth metadata, consumed claim state, and public HTTPS when configured.
- Cloudflare/tunnel credentials are secrets and must be encrypted at rest. Never return them to the browser after save.
- Additional VPS targets are explicit later connections. Do not conflate “where GroundControl runs” with “all servers GroundControl may manage.”
