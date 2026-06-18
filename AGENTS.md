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
- **Terminal helpers**: shown chips adapt to the active VPS (`/api/server-capabilities`). Don't show `systemctl` on OpenRC/Alpine or `caddy` if not installed.
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
- **Terminal AI mode**: `/ai <intent>` in the terminal calls `/api/terminal/ai`, shows the generated POSIX sh command for approval, then runs it via `/api/terminal`. Tab completion calls `/api/terminal/complete`.
- **AI alert synthesis**: `/api/alerts/synthesize` returns `{ summary, rootCauses, actions }` and is shown on the dashboard; the Investigate button opens the AI chat widget with a pre-filled query.

## Code conventions

- Server logic lives in `src/lib/`. All remote/host operations go through `src/lib/vps.ts` (`execOnVps`, `shQuote`).
- API routes must call `requireAuth(req)` and remain thin.
- `src/lib/server-probe.ts` runs POSIX sh / BusyBox-compatible commands for auto-detection.
