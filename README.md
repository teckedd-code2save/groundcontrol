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

GroundControl is a self-hosted infrastructure dashboard: a single control plane for the servers you actually run. It connects to one or more VPS hosts over SSH (or runs locally on the box itself), reads the real state of Docker, Caddy/Nginx, systemd, and the filesystem, and turns it into a live topology you can click, inspect, and act on — all behind your own login.

No agents to install on managed hosts. No SaaS in the middle. No telemetry leaving your network. Just a Next.js app, a SQLite file, and an SSH connection.

> **Live instance:** [https://groundcontrol.serendepify.com](https://groundcontrol.serendepify.com)

---

## ✨ What it does

| | Feature | Why it matters |
|---|---|---|
| 🗺️ | **Live Topology** | Visual React Flow graph of hosts → projects → sites → services → containers. Click any node to inspect or act. |
| 📦 | **Container Ops** | Start, stop, restart, remove, and tail logs. Bulk actions with blast-radius confirmation. |
| 🗂️ | **Projects** | Folder-first view of `/opt`, cross-referenced with Caddy sites and running compose stacks. |
| 🚀 | **Smart Onboarding** | Auto-detects OS, Docker, compose command, and server paths from a local or SSH connection. |
| 🤖 | **AI Ops Assistant** | GPT-powered assistant that reasons about logs, metrics, and deploys with streamed responses. |
| 💻 | **AI Terminal** | Browser terminal with `/ai` natural-language command generation, tab autocomplete, and helper chips. |
| 🔔 | **Alerts & Incidents** | Auto-generated alerts for memory pressure, disk usage, unhealthy containers, and deploy failures. |
| 🤖 | **AI Alert Synthesis** | One-line summary of recent alerts plus recommended actions on the dashboard. |
| 📊 | **Metrics** | CPU, memory, disk, and container health sampled into history and charted with Recharts. |
| 🔀 | **Services** | Containers, reverse proxy, projects, Cloudflare tunnels/DNS, and one-click installs in one tabbed page. |
| ⚙️ | **Tabbed Settings** | Connections, server layout, AI provider/model, security, Cloudflare, and alert rules. |
| 🌩️ | **Cloudflare Integration** | List/create tunnels and manage DNS records from the UI. |
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

# 5. Seed the default admin user
npm run db:seed

# 6. Start the dev server
npm run dev
```

Open **http://localhost:3000**, sign in with `admin` / `groundcontrol2024`, then **change the password immediately** via Settings.

### Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint the codebase |
| `npm run db:seed` | Seed the default admin user (idempotent) |

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

Every host operation — `docker ps`, reading a Caddyfile, sampling `/proc/loadavg` — runs either **locally** (when GroundControl sits on the managed host) or **over SSH** via a cached `node-ssh` connection to the active `VpsConfig`. No agent to install: GroundControl *is* the agent.

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

Then put it behind your reverse proxy. Example Caddy site:

```caddy
groundcontrol.yourdomain.com {
    reverse_proxy localhost:3003
}
```

Open the dashboard and follow the onboarding wizard to register the host. If GroundControl is running directly on the box, choose **This server** so it skips SSH and execs commands directly. You can add more servers anytime from Settings.

### Compose mounts

```yaml
volumes:
  - groundcontrol-db:/app/prisma            # SQLite DB (persists)
  - /var/run/docker.sock:/var/run/docker.sock  # Run docker on the host
  - /opt:/opt                               # Your projects
  - /etc:/etc                               # Caddy/Nginx configs
  - /var/www:/var/www                       # Static site roots (optional)
  - /root/.ssh:/root/.ssh:ro                # SSH key auth scanning (optional)
```

> ⚠️ Some paths (`/opt`, `/etc/caddy/sites/*.caddy`, SSL cert domains in the health-score route) are still **hardcoded in source**. If your layout differs, see the [adaptation guide in CONTRIBUTING.md](./CONTRIBUTING.md).

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
- **Secrets at rest** — VPS keys and passwords are stored in SQLite. **Protect the database file** and run GroundControl only on a host you control. Cloudflare account tokens are encrypted at rest using `encryptCloudflareToken`.
- **Blast radius** — the container mounts `/etc` read-write, so it can read and potentially modify host system configs. The browser terminal has a blocked-command guard, but you are effectively root on the managed host.
- **Never expose it publicly without a reverse proxy + strong credentials.** Run behind HTTPS, change the seeded admin password on first login, and prefer key-based SSH auth over passwords.

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

- [ ] Encrypted secrets at rest (`GROUNDCONTROL_SECRET`)
- [x] Configurable model selection for the AI assistant (`AI_MODEL`)
- [x] Runtime-configurable filesystem paths (per-VPS SystemConfig)
- [x] First-class multi-VPS switcher in Settings + sidebar onboarding
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
