# GroundControl — VPS Cockpit

GroundControl is a self-hosted infrastructure dashboard for managing Docker containers, Caddy proxies, deployments, and system health on a Hetzner-class VPS. It ships as a Next.js application packaged in a Docker container and deploys via GitHub Actions.

**Hosted Platform:** [https://groundcontrol.serendepify.com](https://groundcontrol.serendepify.com)

---

## Overview

- **Topology View** — Interactive SVG visualization of your full infrastructure: Internet → Caddy/Nginx → Sites → Services → Containers. Click any service to reveal its inner topology and container health.
- **Container Management** — Start, stop, restart, remove, and inspect logs with multistep confirmations that declare consequences before acting.
- **Deploy** — Trigger safe `docker compose` deployments directly from the UI with real-time status tracking.
- **Dashboard Intelligence** — Narrative health overview that translates raw stats into actionable insights.
- **Alerts & Incident Tracing** — Automatic alerts for high memory, disk pressure, unhealthy containers, and deploy failures. Trace incidents through a timeline of related events.
- **Terminal** — Browser-based SSH terminal for direct VPS access.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| Database | SQLite (Prisma ORM) |
| SSH | node-ssh / ssh2 |
| Container | Docker (standalone) |
| Registry | GitHub Container Registry (ghcr.io) |
| CI/CD | GitHub Actions |

---

## Local Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Seed the database with a default admin user
npx prisma db seed

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with:
- **Username:** `admin`
- **Password:** `groundcontrol2024`

---

## Deployment

Pushing to the `main` branch triggers the **Build & Deploy** workflow (`.github/workflows/deploy.yml`):

1. Builds the Docker image and pushes to `ghcr.io/teckedd-code2save/groundcontrol:latest`
2. SSHs into the VPS, pulls the latest image, and restarts the stack

```bash
git add .
git commit -m "feat: topology improvements and hardened actions"
git push origin main
```

The VPS must have:
- Docker & Docker Compose installed
- `/opt/groundcontrol` checked out from this repo
- GitHub Container Registry login configured
- Caddy configured to reverse-proxy `groundcontrol.serendepify.com` to the container

---

## Project Structure

```
├── src/
│   ├── app/                 # Next.js App Router pages
│   │   ├── topology/        # Infrastructure visualization
│   │   ├── dashboard/       # Intelligence overview + charts
│   │   ├── containers/      # Docker container management
│   │   ├── deploy/          # Deployment triggers & history
│   │   ├── alerts/          # Incident tracing & alerts inbox
│   │   ├── projects/        # Caddy sites & systemd services
│   │   ├── terminal/        # Browser-based SSH terminal
│   │   └── api/             # Backend API routes
│   ├── components/          # Reusable UI components
│   └── lib/
│       ├── vps.ts           # Core VPS SSH / Docker helpers
│       ├── prisma.ts        # Database client
│       └── alerts.ts        # Alert generation & deduplication
├── prisma/
│   ├── schema.prisma        # Database schema
│   └── seed.ts              # Default admin user seed
├── docker-compose.yml       # Production compose file
├── Dockerfile               # Multi-stage Next.js build
└── .github/workflows/       # CI/CD pipelines
```

---

## Key Features

### Topology
- Icons for Internet, Caddy, Nginx, Sites, Services, and Host nodes
- Services display live container counts (`2/3 running`)
- Click a service to expand its containers with type labels (Frontend, Backend, Database, Proxy)
- Raw IP / localhost domains are automatically filtered from the site column

### Hardened Actions
Every impactful action requires confirmation:
- **Deploy** — warns about brief downtime while containers restart
- **Stop / Restart** — warns about traffic interruption
- **Remove** — warns about permanent deletion
- **Prune Docker** — warns about cache/image removal

### Docker Compose Compatibility
The platform auto-detects whether your VPS uses the modern `docker compose` plugin or the legacy `docker-compose` standalone binary and uses the correct command.

---

## License

MIT
