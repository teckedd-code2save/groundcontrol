<div align="center">

# 🛰️ GroundControl

### The self-hosted cockpit and deployment control plane for your VPS fleet.

**One dashboard to see every container, proxy, deployment, and metric across all your servers — then build, deploy, and expose apps on Docker Compose, Kubernetes, Cloud Run, or Terraform-provisioned infra, with an AI ops assistant riding shotgun.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![OpenAI](https://img.shields.io/badge/AI-OpenAI-412991?logo=openai&logoColor=white)](https://openai.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

---

GroundControl is a self-hosted infrastructure dashboard and deployment control plane: a single pane of glass for the servers you actually run. It connects to one or more VPS hosts over SSH (or runs locally on the box itself), reads the real state of Docker, Caddy/Nginx, systemd, and Kubernetes, and turns it into a live topology you can click, inspect, and act on — all behind your own login.

It also builds and deploys your applications to multiple targets — Docker Compose, static sites, k3s Kubernetes, Google Cloud Run, or Terraform-provisioned infrastructure — and can provision custom domains and ephemeral preview URLs through Cloudflare automatically.

No agents to install on managed hosts. No SaaS in the middle. No telemetry leaving your network. Just a Next.js app, a SQLite file, and an SSH connection.

> **The twist:** GroundControl is designed to run *inside Docker on the VPS it manages*. That should make host-level operations impossible — but it uses a small namespace bridge to escape the container and run commands on the host OS anyway. Read the story in [`docs/THE-HACK.md`](./docs/THE-HACK.md) and the full design in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

**Single-tenant by design.** Each GroundControl instance has its own SQLite database on its own host/VPS. Your data never sits in someone else's instance, and a friend's GroundControl deployment on their VPS has no access to yours.

> **Live instance:** [https://groundcontrol.serendepify.com](https://groundcontrol.serendepify.com)

---

## 🧬 The story

GroundControl started as a dashboard. Then it became an experiment in **containerized privilege**.

The obvious way to ship a VPS cockpit is to put it in a container on the VPS it manages. But containers are jails: the dashboard could see Docker containers through the mounted socket, yet it could not run `systemctl`, install packages with `apk`/`apt`, call `kubectl`, or even find `caddy` on the host. The terminal reported `command not found` for tools that were clearly installed. The install buttons failed. The dashboard lied.

The conventional fixes were uninspiring:

- Run the container with `--pid=host` — works, but forgets to mention it in `docker-compose.yml`.
- Force users to set up SSH keys for the local box — correct, but friction.
- Install a host agent — clean, but now you have two things to update.

GroundControl chose a different path. Since the Docker socket is already root-equivalent, it uses that socket to spawn a one-shot privileged helper container that enters the host's namespaces through `nsenter`. The helper is ephemeral, auto-removed, and lets GC run commands on the host OS as if it were native — without changing the default compose file, without SSH, without a host agent.

That is the hack that makes the terminal feel like a real VPS shell. That is the moment a containerized web app stops being a viewer and becomes a cockpit.

Read the full tale in [`docs/THE-HACK.md`](./docs/THE-HACK.md).

---

## ✨ What it does

| | Feature | Why it matters |
|---|---|---|
| 🗺️ | **Live Topology** | Visual React Flow graph of hosts → projects → sites → services → containers → Kubernetes pods. Click any node to inspect or act. |
| 📦 | **Container Ops** | Start, stop, restart, remove, and tail logs. Bulk actions with blast-radius confirmation. |
| 🗂️ | **Projects** | Folder-first view of `/opt`, cross-referenced with Caddy sites and running compose stacks. |
| 🚀 | **Multi-Target Deployments** | Deploy to Docker Compose, static sites, k3s Kubernetes, Google Cloud Run, or Terraform-provisioned infrastructure from one UI. |
| 🌐 | **Auto-Generated Deploy Links** | Provision custom Cloudflare domains or get ephemeral `trycloudflare.com` preview URLs at deploy time. |
| 📜 | **Terraform Control Plane** | Generate HCL for Hetzner/GCP, run `plan`/`apply`/`destroy`, and use outputs to drive the deploy pipeline. |
| ☁️ | **Cloud Accounts** | Store encrypted GCP/AWS/Azure credentials and use them across deployment targets. |
| 🚀 | **Smart Onboarding** | Auto-detects OS, Docker, compose command, Kubernetes, and server paths from a local or SSH connection. |
| 🤖 | **AI Ops Assistant** | GPT-powered assistant that reasons about logs, metrics, and deploys with streamed responses. |
| 💻 | **AI Terminal** | Browser terminal with `/ai` natural-language command generation, tab autocomplete, and helper chips. |
| 🔔 | **Alerts & Incidents** | Auto-generated alerts for memory pressure, disk usage, unhealthy containers, and deploy failures. |
| 🤖 | **AI Alert Synthesis** | One-line summary of recent alerts plus recommended actions on the dashboard. |
| 📊 | **Metrics** | CPU, memory, disk, and container health sampled into history and charted with Recharts. |
| 💓 | **Container Health Scheduler** | Periodic container health checks on a configurable interval. Alerts when containers go down or become unhealthy — runs independently of the dashboard. |
| 🔀 | **Services** | Containers, reverse proxy, projects, deployments, Cloudflare tunnels/DNS, and one-click installs in one tabbed page. |
| ⚙️ | **Tabbed Settings** | Connections, server layout, AI provider/model, security, Cloudflare, cloud accounts, deploy targets, infrastructure, and alert rules. |
| 🌩️ | **Cloudflare Integration** | List/create tunnels and manage DNS records from the UI, automatically at deploy time. |
| 🛰️ | **Multi-VPS** | Register many hosts; GroundControl talks to whichever VPS is active. |
| 🔐 | **Built-in Auth** | JWT cookie auth, bcrypt passwords, login rate-limiting, and a guarded UI. |

---

## 📸 What it looks like

> Screenshots live in [`docs/screenshots/`](./docs/screenshots/). Drop captures there and they will render below.

<!-- Add screenshots here, e.g.:
![Dashboard](./docs/screenshots/dashboard.png)
![Topology](./docs/screenshots/topology.png)
![Terminal](./docs/screenshots/terminal.png)
-->

---

## 🚀 Quick Start

Run GroundControl locally in minutes. No VPS is required to explore the UI — seed the default user and click around.

```bash
# 1. Clone
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set JWT_SECRET (generate with: openssl rand -hex 32)

# 4. Set up the database
npx prisma migrate dev

# 5. Seed the database (creates schema; no hardcoded admin)
npm run db:seed

# 6. Start the dev server
npm run dev
```

Open **http://localhost:3000**. On a fresh database you will be redirected to `/setup` to create the first admin account with a strong password. Alternatively, set `GC_SETUP_PASSWORD` before running `npm run db:seed` to create the initial `admin` user non-interactively; that account will be forced to change its password on first login.

### Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint the codebase |
| `npm run db:seed` | Seed the database schema (idempotent; no hardcoded password) |

> **Note:** this repo pins **Next.js 16**, which has breaking changes versus older majors. When in doubt, trust `package.json` scripts and the bundled docs over memory.

---

## 🏗️ Architecture

GroundControl is a single Next.js 16 (App Router) app. It does **not** run Caddy, Nginx, or Docker inside its own container — it expects those on the host and reaches them through SSH or mounted host volumes.

```
┌─────────────────────────────────────────────────────────┐
│  Your VPS Host                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  GroundControl container (Next.js, port 3000)     │  │
│  │   • App Router pages + API routes  (src/app)      │  │
│  │   • node-ssh remote-exec layer     (src/lib/vps)  │  │
│  │   • Prisma + SQLite                (prisma/)      │  │
│  │   • JWT cookie auth                (src/lib/auth) │  │
│  └───────────────────────────────────────────────────┘  │
│      │ mounts from host                                  │
│      ├─ /var/run/docker.sock   (run docker on the host) │
│      ├─ /opt                   (your projects)          │
│      ├─ /etc                   (Caddy/Nginx configs)    │
│      ├─ /var/www               (static site roots)      │
│      └─ /root/.ssh  (ro)       (key auth scanning)      │
│                                                         │
│  Caddy / Nginx + Docker daemon  (on the host)           │
└─────────────────────────────────────────────────────────┘
        ▲  SSH (node-ssh)
        └──────────  ... or other remote VPS hosts in the fleet
```

Every host operation — `docker ps`, reading a Caddyfile, sampling `/proc/loadavg`, running `kubectl`, or executing `terraform` — runs either **locally** (when GroundControl sits on the managed host) or **over SSH** via a cached `node-ssh` connection to the active `VpsConfig`. No agent to install: GroundControl *is* the agent.

Deployments are handled by a pluggable target system (`src/lib/deploy/targets/`). Each target implements a common `DeployTarget` interface, so the UI and API stay agnostic to whether a project lands on Compose, k3s, Cloud Run, or Terraform-provisioned infra.

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Graph | React Flow + Dagre |
| Charts | Recharts |
| Terminal | xterm.js + socket.io |
| Database | SQLite via Prisma ORM |
| Remote exec | node-ssh / ssh2 |
| Kubernetes | k3s, kubectl, Helm |
| Cloud APIs | GCP Cloud Run (JWT auth), Cloudflare v4 API |
| IaC | Terraform (runner on active VPS) |
| AI | OpenAI SDK (streamed chat) |
| Auth | JWT + bcrypt |
| 3D Hero | React Three Fiber + Three.js |
| Packaging | Docker, GHCR, GitHub Actions |

---

## 🖥️ Self-host in 5 minutes

GroundControl is designed to run *inside Docker on the VPS it manages*.

```bash
# On your VPS
cd /opt
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol

# Generate a strong JWT secret straight into .env
printf 'JWT_SECRET="%s"\n' "$(openssl rand -hex 32)" > .env

# Bring it up (binds 127.0.0.1:3003 -> container:3000)
docker compose up -d
```

Then put it behind Caddy or Nginx with SSL. For the full walkthrough — domain, DNS, Caddy, Cloudflare, first-run setup, and updates — see **[DEPLOY.md](./DEPLOY.md)**.

### Deploy via CI/CD

The repo ships a GitHub Actions workflow that builds the image, pushes it to GHCR, and deploys over SSH on push to `main`:

1. Fork the repo.
2. Change image references in `docker-compose.yml` and `.github/workflows/` to `ghcr.io/YOUR_USERNAME/groundcontrol:latest`.
3. Add repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.
4. Push to `main`.

---

## 🔐 Security

GroundControl runs commands on your servers. Treat it like the powerful tool it is.

- **Authentication** — every API route is guarded by a JWT cookie (`gc_token`, httpOnly, `secure` in production, 7-day expiry). Passwords are bcrypt-hashed (cost 12). Login is rate-limited (5 attempts / 15 min per IP).
- **Strong passwords** — first-run setup and password changes enforce a 12-character minimum with uppercase, lowercase, number, and symbol.
- **Audit log** — login, logout, password-change, and failed sign-in events are recorded with IP and timestamp. Admins can review them in **Settings → Security → Authentication Audit Log**.
- **Secrets at rest** — VPS keys, passwords, cloud-provider credentials, Terraform variables, and Cloudflare tokens are encrypted at rest in SQLite. **Protect the database file** and run GroundControl only on a host you control.
- **Blast radius** — the container mounts `/etc` read-write, so it can read and potentially modify host system configs. The browser terminal has a blocked-command guard, but you are effectively root on the managed host.
- **Never expose it publicly without a reverse proxy + strong credentials.** Run behind HTTPS, prefer key-based SSH auth over passwords, and review the audit log regularly.

Full responsible-disclosure policy and threat model: [SECURITY.md](./SECURITY.md).

---

## 🧭 Why this project is impressive

GroundControl is a from-scratch, full-stack DevOps product, not a tutorial clone. It demonstrates:

- **Multi-VPS orchestration** — a single control plane managing a fleet over a cached SSH transport, with a clean local-vs-remote execution abstraction.
- **An agentic AI ops assistant** — an embedded, context-aware LLM that reasons about real logs, metrics, and deploys, with streamed responses.
- **Live infrastructure topology** — a clickable, auto-laid-out graph generated from the actual state of Docker, the proxy, and the filesystem.
- **Real systems integration** — parsing Caddyfiles, inspecting Docker labels to map containers ↔ compose projects, sampling `/proc`, and reconciling `docker-compose` vs `docker compose` quirks.
- **Production packaging** — Dockerized, published to GHCR, auto-deployed via GitHub Actions, with healthchecks and a persisted SQLite volume.
- **Security-conscious by default** — JWT auth, bcrypt, rate-limiting, and an explicit threat model.

---

## 🛣️ Roadmap

- [x] Encrypted secrets at rest (`GROUNDCONTROL_SECRET`)
- [x] Configurable model selection for the AI assistant (`AI_MODEL`)
- [x] Runtime-configurable filesystem paths (per-VPS SystemConfig)
- [x] First-class multi-VPS switcher in Settings + sidebar onboarding
- [x] Git-based build + deploy pipeline with deployment targets
- [x] Cloudflare auto-DNS and ephemeral preview URLs
- [x] k3s / Kubernetes deploy target
- [x] Google Cloud Run managed deploy target
- [x] Terraform-first infrastructure control plane
- [ ] AWS Fargate / Azure Container Apps deploy targets
- [ ] Background job queue + real-time deploy logs
- [ ] Auto-create VPS connections from Terraform output
- [ ] Role-based access control beyond single-admin
- [ ] One-click container/stack rollback from the topology view
- [ ] Exportable metrics (Prometheus endpoint)

See [docs/PENDINGS.md](./docs/PENDINGS.md) for the full list of known sharp edges and recommended next steps.

---

## 🤝 Contributing

Dev setup, project structure map, code conventions, and how to add a page or API route all live in [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome.

## 📚 Docs

- [DEPLOY.md](./DEPLOY.md) — full self-deployment guide (VPS, domain, Caddy, SSL, Cloudflare)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup & project map
- [SECURITY.md](./SECURITY.md) — disclosure policy & threat model
- [docs/PENDINGS.md](./docs/PENDINGS.md) — known sharp edges, pending work, and recommended next steps
- [docs/DEMO.md](./docs/DEMO.md) — click-by-click demo recording script
- [docs/demo-data.md](./docs/demo-data.md) — safe demo seed data (no real VPS needed)
- [docs/screenshots/](./docs/screenshots/) — what to capture for the README

## 📝 License

[MIT](./LICENSE) © 2026 GroundControl contributors
