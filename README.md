<div align="center">

# 🛰️ GroundControl

### The self-hosted cockpit for your VPS fleet.

**One dashboard to see every container, proxy, deployment, and metric across all your servers — with an AI ops assistant riding shotgun.**

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

GroundControl is a self-hosted infrastructure dashboard that gives you a single, opinionated control plane for the servers you actually run. It connects to one or more VPS hosts over SSH (or runs locally on the box itself), reads the real state of Docker, Caddy/Nginx, systemd, and the filesystem, and turns it into a live topology you can click, inspect, and act on — all behind your own login.

No agents to install on managed hosts. No SaaS in the middle. No telemetry leaving your network. Just a Next.js app, a SQLite file, and an SSH connection.

> **Live instance:** [https://groundcontrol.serendepify.com](https://groundcontrol.serendepify.com)

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 🗺️ | **Live Topology** | Top-down graph: Internet → VPS Host → Caddy/Nginx → Sites → Containers, rendered with React Flow + Dagre. Click any node to inspect or act on it. |
| 📦 | **Container Management** | List, start, stop, restart, remove, and tail logs for every Docker container. Destructive actions require a confirmation that explains the blast radius. |
| 🗂️ | **Projects** | Folder-first view of everything under `/opt`, cross-referenced with Caddy sites and running compose stacks. |
| 🤖 | **AI Ops Assistant** | An embedded GPT-powered assistant that knows it's inside a VPS cockpit — ask it to interpret logs, debug a failing deploy, or explain a metric, in plain English. Streamed responses. |
| 💻 | **Browser Terminal** | An xterm.js terminal wired to a real SSH session on the active host, with a blocked-command guard for the obviously dangerous stuff. |
| 🔔 | **Alerts & Incidents** | Auto-generated alerts for memory pressure, disk usage, unhealthy containers, and deploy failures, with severity levels and an incident timeline. |
| 📊 | **Metrics** | CPU load, memory, disk, and container health sampled into `MetricSnapshot` history and charted with Recharts. |
| 🔀 | **Proxy / Caddy & Nginx** | Reads and validates reverse-proxy configs, maps sites to the containers that serve them, and can reload the proxy. |
| 🛰️ | **Multi-VPS** | Register multiple hosts in `VpsConfig`; GroundControl talks to whichever is active. Manage a fleet, not just a box. |
| 🔐 | **Auth built-in** | JWT cookie auth, bcrypt password hashing, login rate-limiting, and a guarded UI. |

> Screenshots live in [`docs/screenshots/`](./docs/screenshots/) — see the [capture guide](./docs/screenshots/README.md) for what to shoot. Drop them in and they'll render here.

---

## 🏗️ Architecture

GroundControl is a single Next.js 16 (App Router) application. It does **not** run Caddy, Nginx, or Docker inside its own container — it expects those on the host and reaches them through SSH or mounted host volumes.

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
│      ├─ /var/run/docker.sock   (run docker on the host)  │
│      ├─ /opt                   (your projects)           │
│      ├─ /etc                   (Caddy/Nginx configs)     │
│      ├─ /var/www               (static site roots)       │
│      └─ /root/.ssh  (ro)       (key auth scanning)       │
│                                                         │
│  Caddy / Nginx + Docker daemon  (on the host)           │
└─────────────────────────────────────────────────────────┘
        ▲  SSH (node-ssh)
        └──────────  ... or other remote VPS hosts in the fleet
```

**The remote-exec model** (`src/lib/vps.ts`) is the heart of the app. Every operation — `docker ps`, reading a Caddyfile, sampling `/proc/loadavg` — is a shell command run either:
- **locally** (`isLocal` mode) when GroundControl runs directly on the host it manages, or
- **over SSH** via a cached `node-ssh` connection to the active `VpsConfig`.

This is why there's no agent to install on managed hosts: GroundControl *is* the agent, and it speaks SSH.

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Graph | React Flow (`@xyflow/react`) + Dagre |
| Charts | Recharts |
| Terminal | xterm.js + socket.io |
| Database | SQLite via Prisma ORM |
| Remote exec | node-ssh / ssh2 |
| AI | OpenAI SDK (streamed chat) |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Packaging | Docker, GitHub Container Registry, GitHub Actions |

---

## 🚀 Quick Start

Get it running locally in a couple of minutes. You don't need a VPS to explore the UI — seed demo data (see below) and click around.

```bash
# 1. Clone
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol

# 2. Install
npm install

# 3. Configure env
cp .env.example .env
#    then edit .env and set JWT_SECRET (openssl rand -hex 32)

# 4. Create the database + Prisma client
npx prisma migrate dev      # applies migrations and generates the client

# 5. Seed the default admin user (admin / groundcontrol2024)
npm run db:seed

# 6. Run
npm run dev
```

Open **http://localhost:3000**, log in with `admin` / `groundcontrol2024`, and **change the password immediately** (Settings → change password).

### Available scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `next dev` | Start the dev server (http://localhost:3000) |
| `npm run build` | `next build` | Production build |
| `npm run start` | `next start` | Serve the production build |
| `npm run lint` | `eslint` | Lint the codebase |
| `npm run db:seed` | `tsx prisma/seed.ts` | Seed the default admin user (idempotent) |

> ℹ️ **Note for contributors / AI agents:** this repo pins **Next.js 16**, which has breaking changes vs. older majors. When in doubt about build/run conventions, trust `package.json` scripts and the bundled docs over memory.

---

## 🖥️ Self-host in 5 minutes

GroundControl is designed to run *inside Docker on the VPS it manages*. The published image already exists at `ghcr.io/teckedd-code2save/groundcontrol:latest`.

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

Then put it behind your reverse proxy. Example Caddy site (`/etc/caddy/sites/groundcontrol.caddy`):

```caddy
groundcontrol.yourdomain.com {
    reverse_proxy localhost:3003
}
```

Finally, open the dashboard, go to **Settings → VPS Connection**, and register the host (host, port, username, key/password). If GroundControl is running directly on the box, enable **Local Mode** so it skips SSH and execs commands directly.

### What the compose file mounts (and why)

```yaml
volumes:
  - groundcontrol-db:/app/prisma            # SQLite DB on a named volume (persists)
  - /var/run/docker.sock:/var/run/docker.sock  # Required: run docker on the host
  - /opt:/opt                               # Required: your projects live here
  - /etc:/etc                               # Required: read Caddy/Nginx configs
  - /var/www:/var/www                       # Optional: static site roots
  - /root/.ssh:/root/.ssh:ro                # Optional: SSH key auth scanning
```

> ⚠️ Several paths (`/opt`, `/etc/caddy/sites/*.caddy`, the SSL cert domain in the health-score route) are still **hardcoded in source**. If your server layout differs, see the [adaptation guide in CONTRIBUTING.md](./CONTRIBUTING.md) for exactly which files to edit.

### Deploy to your own VPS via CI/CD

The repo ships a GitHub Actions workflow that builds the image, pushes it to GHCR, and deploys over SSH on push to `main`. To make it yours:

1. Fork the repo.
2. Change the image reference in `docker-compose.yml` and `.github/workflows/` to `ghcr.io/YOUR_USERNAME/groundcontrol:latest`.
3. Add repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.
4. Push to `main`.

---

## 🔐 Security

GroundControl runs commands on your servers. Treat it like the powerful tool it is.

- **Authentication** — every API route is guarded by a JWT cookie (`gc_token`, httpOnly, `secure` in production, 7-day expiry). Passwords are bcrypt-hashed (cost 12). Login is rate-limited (5 attempts / 15 min per IP).
- **SSH credentials at rest** — VPS keys and passwords are stored in the SQLite `VpsConfig` table. **Protect the database file** and run on a host only you control. (Encryption-at-rest for stored secrets is on the roadmap via `GROUNDCONTROL_SECRET`.)
- **Blast radius** — the container mounts `/etc` read-write, so it can read and potentially modify host system configs. The browser terminal has a blocked-command guard, but you are effectively root on the managed host.
- **Never expose it publicly without a reverse proxy + strong credentials.** Run behind HTTPS, change the seeded admin password on first login, and prefer key-based SSH auth over passwords.

Full responsible-disclosure policy and threat model: [SECURITY.md](./SECURITY.md).

---

## 🧭 Why this project is impressive (the CV angle)

GroundControl is a from-scratch, full-stack DevOps product, not a tutorial clone. It demonstrates:

- **Multi-VPS orchestration** — a single control plane managing a fleet of hosts over a cached SSH transport, with a clean local-vs-remote execution abstraction.
- **An agentic AI ops assistant** — an embedded, context-aware LLM that reasons about real logs, metrics, and deploys, with streamed responses.
- **Live infrastructure topology** — a clickable, auto-laid-out graph (React Flow + Dagre) generated from the *actual* state of Docker, the proxy, and the filesystem.
- **Real systems integration** — parsing Caddyfiles, inspecting Docker labels to map containers ↔ compose projects, sampling `/proc`, and reconciling `docker-compose` vs `docker compose` portability quirks.
- **Production packaging** — Dockerized, published to GHCR, auto-deployed via GitHub Actions, with healthchecks and a persisted SQLite volume.
- **Security-conscious by default** — JWT auth, bcrypt, rate-limiting, and an explicit threat model.

### 🛣️ Roadmap

- [ ] Encrypted secrets at rest (`GROUNDCONTROL_SECRET`)
- [ ] Configurable model selection for the AI assistant (`AI_MODEL`)
- [ ] Runtime-configurable filesystem paths (drop the hardcoded `/opt`, `/etc/caddy/...`)
- [ ] First-class multi-VPS switcher in the top nav
- [ ] Role-based access control beyond single-admin
- [ ] One-click container/stack rollback from the topology view
- [ ] Exportable metrics (Prometheus endpoint)

---

## 🤝 Contributing

Dev setup, project structure map, code conventions, and how to add a page or API route all live in [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome.

## 📚 Docs

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup & project map
- [SECURITY.md](./SECURITY.md) — disclosure policy & threat model
- [docs/DEMO.md](./docs/DEMO.md) — click-by-click demo recording script
- [docs/demo-data.md](./docs/demo-data.md) — safe demo seed data (no real VPS needed)
- [docs/screenshots/](./docs/screenshots/) — what to capture for the README

## 📝 License

[MIT](./LICENSE) © 2026 GroundControl contributors
