# GroundControl product cleanup goals

This backlog tracks the product goal of making GroundControl feel like a serious cloud SaaS platform: clear, fast, polished, useful, and marketable without losing operational depth.

## Global product principles

- First screens show status, priority, and next action only.
- Dense technical detail lives in drawers, tabs, or expandable history.
- Avoid placeholder text on cards when there is no useful value.
- Prefer icons and concise labels for repeated controls.
- Avoid all-caps headings, raw command strings, raw hashes, and raw paths outside details.
- Each tab should answer: what is healthy, what needs attention, and what can I safely do next?

## Dashboard

- Progress: top stack simplified into compact metrics plus one attention strip.
- Goal: executive command view, not a monitoring dump.
- Top area: compact metric strip, one attention summary, one investigate action.
- Move detailed health scoring, suggested fixes, alert rules, and AI recommendations behind expandable sections or dedicated pages.
- Keep charts below the first viewport and make them useful for trends, not decoration.
- Marketability: screenshot should communicate control, clarity, and confidence within 5 seconds.

## Topology

- Goal: trustworthy service map.
- Group by deployment, route, proxy, and data dependency.
- Make uncertain links visibly lower confidence instead of pretending certainty.
- Put node internals in a drawer: runtime, source, env, networking, storage, logs.
- Marketability: screenshot should show how GC understands a VPS estate.

## Services

- Progress: Services shell now uses compact tab chrome and active-tab descriptions.

### Containers

- Goal: operational fleet table.
- Group by running, unhealthy, stopped, and unmanaged only if that status changes behavior.
- Keep restart/log/image actions in row menus.
- Show linked deployment/component when known.

### Deployments

- Goal: cloud deployment inventory.
- Cards show name, health, route, component count, latest version, and last deploy when known.
- Details drawer owns components, environment, source, networking, storage, activity.
- Replication and rollback must be scoped and explicit.

### Install

- Goal: host bootstrap cockpit.
- Show missing, installed, upgradeable, and blocked tools.
- Use OS-aware commands only through GroundControl actions.
- Keep raw install output behind expandable logs.

### Infrastructure

- Goal: infrastructure control plane.
- Show stack health, last plan/apply, drift, provider, and protected resources.
- Put HCL/output/raw logs behind tabs.
- Make destructive actions require clear previews.

## Terminal

- Goal: safe server console.
- Commands should be contextual to active host capabilities.
- AI mode should explain risk, command, and rollback before execution.
- Common actions should be chips, not copied docs.

## Alerts

- Goal: actionable incident queue.
- Group by severity and affected deployment/resource.
- Deduplicate noisy alerts.
- Every alert should have owner surface, suggested action, and evidence.

## Settings

- Progress: Settings shell now uses compact tab chrome, contextual subtitles, and no product-stage badges.

### Connections

- Goal: reliable host/account setup.
- Show active host, health, auth method, and last test.
- Advanced SSH fields stay collapsed after setup.

### Server layout

- Goal: predictable filesystem and runtime roots.
- Clearly separate scan roots, deployment roots, backup roots, and template roots.
- Validate roots before saving.

### AI

- Goal: helpful assistant configuration.
- Show provider status, model, available tools, and data boundaries.
- Keep token/model internals in advanced settings.

### Security

- Goal: hardening posture.
- Show session, auth, encryption, secrets, and audit controls.
- Provide remediation actions for weak settings.

### Cloudflare

- Goal: DNS/tunnel wiring confidence.
- Show active account, zones, tunnels, route ownership, and conflicts.
- Raw record IDs stay in details.

### Env providers

- Goal: provider-agnostic env management.
- Local encrypted env is always available.
- Infisical is optional and configurable.
- Each deployment can choose provider, import discovered env, save edits, and redeploy.

### Alerts

- Goal: alert policy management.
- Show enabled rules, noise level, retention, and evaluation health.
- Make default rules sane for VPS teams.

### Cloud accounts

- Goal: pluggable cloud credentials.
- Show provider, status, scope, last test, and consumers.
- Keep credentials masked and auditable.

### Deploy targets

- Goal: deployment backend catalog.
- Show active target, capabilities, required config, and supported rollback/health semantics.
- Avoid experimental wording on production-ready targets.

### Infrastructure

- Goal: safe IaC operations.
- Show stack state, drift, last plan, last apply, and linked deployments.
- Plans and raw outputs live in drawers.

## Templates

- Goal: mature deployment starters.
- Keep the active catalog small, hardened, and explain layer membership.
- Validate source, env, ports, routes, proxy, DNS, and health before success.
- Show deployment preview before writing files.

## Login and marketing surfaces

- Goal: prove product value before login.
- Use real screenshots, concise copy, and one clear CTA.
- Avoid technical clutter that belongs inside the product.
