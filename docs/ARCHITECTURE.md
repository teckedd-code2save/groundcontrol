# GroundControl Architecture

> A single-tenant, self-hosted control plane that turns a Next.js app into a VPS cockpit.

---

## Philosophy

GroundControl is designed around one idea: **the dashboard should run on the machine it manages**, without requiring a separate host agent, SaaS middleman, or exotic runtime flags.

Most server dashboards force you to choose between:

1. **Agent-based tools** — install a daemon on every host, manage versions, open firewall ports.
2. **SaaS control planes** — hand your server credentials to someone else's cloud.
3. **SSH-only dashboards** — maintain keys, bastion hosts, and jump boxes.

GroundControl takes a fourth path: a containerized Next.js app that talks to the host OS through the same Docker socket it uses to manage containers. When it needs root-level access, it asks Docker to spawn a one-shot privileged helper that enters the host namespaces. See [THE-HACK.md](./THE-HACK.md) for the full story.

---

## High-level layout

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Your VPS Host                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │           GroundControl container (port 3000)               │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │   │
│  │  │ App Router   │  │ API routes   │  │ Terminal / AI   │   │   │
│  │  │ (src/app)    │  │ (src/app/api)│  │ chat widgets    │   │   │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘   │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │   │
│  │  │ Prisma +     │  │ node-ssh     │  │ Docker socket   │   │   │
│  │  │ SQLite       │  │ remote exec  │  │ bridge          │   │   │
│  │  │ (prisma/)    │  │ (src/lib/vps)│  │ (src/lib/host)  │   │   │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│      bind mounts             │   Docker API                         │
│      ├─ /var/run/docker.sock │   (create/inspect/exec containers)   │
│      ├─ /opt                 │                                      │
│      ├─ /etc                 │   ┌─────────────────────────────┐    │
│      ├─ /var/www             └──►│ Host Docker daemon (root)   │    │
│      └─ /root/.ssh  (ro)         └─────────────────────────────┘    │
│                                              │                      │
│                                              ▼                      │
│                           ┌─────────────────────────────┐           │
│                           │ groundcontrol-host-bridge   │           │
│                           │ (ephemeral privileged helper)│          │
│                           └─────────────────────────────┘           │
│                                              │                      │
│                                              ▼ nsenter -t 1 ...     │
│                           ┌─────────────────────────────┐           │
│                           │ Host OS namespaces          │           │
│                           │ (systemd, apk, kubectl, ...)│           │
│                           └─────────────────────────────┘           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Caddy / Nginx + Docker + k3s + your apps (on the host)     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ SSH (node-ssh)
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                    Other VPS hosts in the fleet                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Execution model

All host operations go through `execOnTarget` in `src/lib/host-exec.ts`.

```
execOnTarget(command, vps?, cwd?)
    │
    ├── SSH connection? ──────────────────────► execOnVps over node-ssh
    │
    ├── Local bare-metal? ────────────────────► execOnVps locally
    │
    └── Containerized on the host?
            │
            ├── Strategy 0: Docker host bridge ◄── default, works with vanilla compose
            ├── Strategy 1: nsenter              ── requires --pid=host
            ├── Strategy 2: SSH loopback         ── requires host SSH credentials
            └── Strategy 3: container fallback   ── warns, runs inside GC container
```

The bridge is Strategy 0 because it is the only strategy that works with the standard `docker-compose.yml` — no extra flags, no SSH keys, no host agent.

---

## Key modules

| Module | Responsibility |
|---|---|
| `src/lib/vps.ts` | SSH connection caching, remote/local command execution, Docker/compose helpers, binary resolution. |
| `src/lib/host-exec.ts` | Decide whether to run on host, container, or remote; orchestrate the bridge. |
| `src/lib/docker-host-bridge.ts` | Build and run the ephemeral privileged helper container. |
| `src/lib/host-capabilities.ts` | Cache and verify what the active host can do, including whether host access is real. |
| `src/lib/server-probe.ts` | Auto-detect OS family, init system, compose command, and common paths. |
| `src/lib/bootstrap.ts` | One-click installers for Docker, Caddy, Nginx, k3s, kubectl, Helm, Terraform, etc. |
| `src/lib/deploy/targets/` | Pluggable deployment targets: compose, static, k3s, cloudrun, terraform. |
| `src/lib/ai-agent.ts` | AI tool set; host-aware tools route through `execOnTarget`. |

---

## Data model

GroundControl is intentionally single-tenant. Each instance has one SQLite database.

```
User ──► Session (JWT cookie)
        │
        ├─► VpsConfig (many hosts, one active)
        ├─► SystemConfig (paths per VPS)
        ├─► Project (repo, domain, deploy target)
        ├─► Deployment (build/run history)
        ├─► AlertRule / Alert (monitoring + incidents)
        ├─► CloudAccount (encrypted GCP/AWS/Azure credentials)
        ├─► CloudflareAccount (encrypted tokens)
        ├─► TerraformStack (infrastructure state)
        ├─► AiThread / AiMessage / AiToolCall (AI memory)
        └─► AuditLog (security events)
```

The active `VpsConfig` determines where host commands run. Switching the active host switches every panel, terminal command, and deployment target.

---

## Deployment targets

The deploy pipeline is pluggable. Each target implements the same interface but produces different artifacts:

- **compose** — builds a Docker image, writes `docker-compose.yml`, runs `docker compose up`.
- **static** — builds a static site, copies it to `/var/www/<project>`, updates Caddy/Nginx.
- **k3s** — builds an image, generates Kubernetes manifests, applies with `kubectl`.
- **cloudrun** — pushes to Google Artifact Registry, deploys to Cloud Run.
- **terraform** — provisions infra first, then delegates to another target with outputs.

Target selection lives in the Projects panel; per-target configuration lives in **Settings → Deploy Targets**.

---

## AI integration

The AI assistant is context-aware:

- The system prompt includes the active host's capabilities (OS, init system, installed tools, missing tools).
- Tool calls for host operations route through `execOnTarget`.
- Read-only tools (`get_host_capabilities`, `read_system_file`) require no confirmation.
- Mutating tools (`ensure_software`, `manage_service`, `write_system_file`) require user confirmation.
- Every tool execution is audit-logged.

Because the AI knows whether the host runs `systemctl` or `rc-service`, `apt` or `apk`, it generates correct commands for the actual box.

---

## Security notes

- Authentication is JWT cookie-based; passwords are bcrypt-hashed.
- API routes are guarded by `requireAuth`.
- The Docker socket mount is root-equivalent; treat the GC container accordingly.
- Host-level AI tools are gated by safety allow-lists in `src/lib/host-safety.ts`.
- Audit logs capture auth events and AI tool executions.

---

## See also

- [THE-HACK.md](./THE-HACK.md) — the container-to-host bridge story
- [DEPLOY.md](./DEPLOY.md) — production deployment guide
- [DEMO.md](./DEMO.md) — demo recording script
