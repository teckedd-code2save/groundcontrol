# GroundControl — VPS Cockpit

A self-hosted infrastructure dashboard for managing Docker containers, Caddy proxies, deployments, and system health on a VPS. It runs as a Docker container with privileged host filesystem mounts.

**Live instance:** [https://groundcontrol.serendepify.com](https://groundcontrol.serendepify.com)

---

## What It Does

- **Topology** — Top-down visualization: Internet → VPS Host → Caddy → Sites → Containers. Click any node to inspect or act on it.
- **Container Management** — Start, stop, restart, remove, view logs. All destructive actions require a confirmation that explains the consequence.
- **Deploy** — Trigger `docker compose pull && up` on projects in `/opt/<slug>/` with live status tracking.
- **Dashboard Intelligence** — Narrative health overview that translates raw stats into plain-English insights.
- **Alerts & Incident Tracing** — Auto-generated alerts for memory pressure, disk usage, unhealthy containers, and deploy failures. Trace incidents through timelines.
- **Terminal** — Browser-based SSH session to your VPS.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Your VPS Host                          │
│  ┌─────────────────────────────────┐    │
│  │  GroundControl Container        │    │
│  │  ┌───────────────────────────┐  │    │
│  │  │  Next.js app (port 3000)  │  │    │
│  │  │  SQLite (Prisma)          │  │    │
│  │  └───────────────────────────┘  │    │
│  │                                 │    │
│  │  Mounted from host:             │    │
│  │  • /var/run/docker.sock         │    │
│  │  • /opt                         │    │
│  │  • /etc                         │    │
│  │  • /var/www                     │    │
│  │  • /root/.ssh (read-only)       │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Caddy/Nginx (on host)                  │
│  Docker daemon (on host)                │
└─────────────────────────────────────────┘
```

GroundControl does **not** run Caddy or Nginx inside its own container. It expects those to be installed on the host (or in other containers) and accesses their configs through mounted host volumes.

---

## What This Project Assumes About Your VPS

Before you adopt this, verify your server matches these assumptions or be prepared to fork and change hardcoded paths.

### Filesystem Layout

| Path | Purpose | Configurable? |
|------|---------|---------------|
| `/opt/` | Projects/repos deployed here | **Hardcoded** in `src/lib/vps.ts`, deploy API, and UI messages |
| `/etc/caddy/sites/*.caddy` | Caddy site configs | **Hardcoded** in `src/lib/vps.ts` and proxy API |
| `/etc/caddy/Caddyfile` | Main Caddy config | **Hardcoded** in proxy API reload/validate commands |
| `/etc/nginx/sites-available/*` | Nginx site configs | **Hardcoded** in proxy API |
| `/var/log/nginx/error.log` | Nginx logs | **Hardcoded** in proxy API |
| `/var/www/` | Static site roots | Mounted in `docker-compose.yml` but only used if your Caddy config points there |
| `/var/run/docker.sock` | Docker daemon socket | Mounted in `docker-compose.yml` |

**To change these paths:** You must edit the source code in `src/lib/vps.ts`, `src/app/api/proxy/route.ts`, and `src/app/api/deploy/route.ts`. There is no runtime configuration for filesystem paths yet.

### Binaries

GroundControl tries to auto-discover binaries using `which`, then falls back to common paths (`/usr/local/bin`, `/usr/bin`, `/bin`, `/opt`, `/snap/bin`), and finally tries `docker exec <container>` for Caddy/Nginx.

| Binary | Used For | Discovery |
|--------|----------|-----------|
| `docker` | Container ops | Expected in `$PATH` |
| `docker compose` or `docker-compose` | Deployments | Auto-detected at runtime |
| `caddy` | Proxy status, reload, validate | Auto-discovered (see above) |
| `nginx` | Proxy status, reload | Auto-discovered (see above) |
| `systemctl` | Service status, reloads | Expected in `$PATH` |
| `openssl` | SSL cert expiry check | Expected in `$PATH` |

### Network

- The container binds to `127.0.0.1:3003` on the host by default (override with `HOST_PORT` env var).
- You must run a reverse proxy (Caddy/Nginx/Traefik) on the host to forward HTTPS traffic to `localhost:3003`.
- The GitHub Actions workflow deploys to `/opt/groundcontrol` and expects the VPS to have Docker and Docker Compose installed.

### SSH / VPS Connection

- Default SSH port: `22`
- Default username: `root`
- Auth: key or password
- Credentials are stored in SQLite (`VpsConfig` table)
- `isLocal` mode skips SSH and runs commands directly (useful if GroundControl runs directly on the VPS host instead of inside Docker)

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Required
JWT_SECRET="change-me-to-a-long-random-string"

# Database (dev)
DATABASE_URL="file:./dev.db"

# Docker Compose only
HOST_PORT=3003
```

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `JWT_SECRET` | **Yes** | — | Signs auth tokens. If missing, the app crashes at runtime. |
| `DATABASE_URL` | Yes | `file:./dev.db` | Prisma SQLite connection string. In production the container overrides this to `file:/app/prisma/prod.db`. |
| `NODE_ENV` | No | — | Set to `production` in the container image. Affects cookie `secure` flag and Prisma behavior. |
| `HOST_PORT` | No | `3003` | Host port that Docker Compose binds `127.0.0.1` to. |

---

## First-Time Setup

### 1. Clone and configure

```bash
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol

# Create env file
cp .env.example .env  # or create manually
# Edit .env and set JWT_SECRET to a long random string
```

### 2. Build and run locally (optional)

```bash
npm install
npx prisma generate
npx prisma db seed   # creates admin / groundcontrol2024
npm run dev
```

Open `http://localhost:3000`, log in with `admin` / `groundcontrol2024`, then **immediately change the password**.

### 3. Deploy to your VPS

The project is designed to run inside Docker on the VPS it manages.

**On your VPS:**

```bash
cd /opt
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol
```

**Create `.env` on the VPS:**

```bash
echo 'JWT_SECRET="$(openssl rand -hex 32)"' > .env
```

**Start the container:**

```bash
docker compose up -d
```

The app will be available at `http://localhost:3003` on the host. Point your reverse proxy (Caddy/Nginx) to that port.

**Example Caddy config** (`/etc/caddy/sites/groundcontrol.caddy`):

```caddy
groundcontrol.yourdomain.com {
    reverse_proxy localhost:3003
}
```

### 4. Configure VPS connection in the UI

1. Open GroundControl in your browser
2. Go to **Settings → VPS Connection**
3. Enter your VPS host, port, username, and auth method
4. Test the connection and save

If GroundControl is running **directly on the VPS host** (not in Docker), enable **Local Mode** (`isLocal`) so it skips SSH and runs commands directly.

---

## Docker Compose Volume Mounts Explained

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock   # Required. Lets the container run docker commands on the host.
  - /opt:/opt                                     # Required. Projects are expected here.
  - /etc:/etc                                     # Required. Reads Caddy/Nginx configs.
  - /var/www:/var/www                             # Optional. If you serve static sites from /var/www.
  - /root/.ssh:/root/.ssh:ro                      # Optional. Used for SSH key auth scanning.
```

**If your setup differs:** Edit `docker-compose.yml` before running. For example, if your projects live in `/home/deploy/projects` instead of `/opt`, change the mount:

```yaml
volumes:
  - /home/deploy/projects:/opt                    # Map your project dir to /opt inside container
```

But remember: the **app code still hardcodes `/opt/`** in commands like `cd /opt/${projectSlug}`. You would need to update `src/lib/vps.ts` and `src/app/api/deploy/route.ts` to match your actual path.

---

## Adapting to Your Own VPS

### Change the container registry

The image is published to `ghcr.io/teckedd-code2save/groundcontrol:latest`. To use your own:

1. Fork this repo
2. In `docker-compose.yml`, change:
   ```yaml
   image: ghcr.io/YOUR_USERNAME/groundcontrol:latest
   ```
3. In `.github/workflows/deploy.yml`, update the same image reference
4. Set GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`

### Change the project root path

If your projects are not in `/opt/`:

1. Edit `src/lib/vps.ts`:
   - Line ~306: `ls -1 /opt/ 2>/dev/null` → your path
2. Edit `src/app/api/deploy/route.ts`:
   - Line ~31: `/opt/${projectSlug}` → your path
3. Edit `src/app/deploy/page.tsx`:
   - Update the UI message that says `/opt/{project.slug}`
4. Edit `docker-compose.yml`:
   - Update the `/opt` volume mount

### Change Caddy config paths

If your Caddy configs live somewhere other than `/etc/caddy/sites/*.caddy`:

1. Edit `src/lib/vps.ts`:
   - Line ~313: update the `for f in /etc/caddy/sites/*.caddy` glob
2. Edit `src/app/api/proxy/route.ts`:
   - Lines ~22, ~65: update Caddy config paths

### Change the SSL cert domain check

`src/app/api/health-score/route.ts` hardcodes `groundcontrol.serendepify.com.crt`. Change this to your domain's cert path.

### Use Nginx instead of Caddy

The app supports both. If you only use Nginx:
- The topology will auto-detect Nginx from systemd services
- Caddy nodes won't appear if `resolveBinary("caddy")` fails
- You may want to hide Caddy-specific UI elements (not yet configurable)

---

## Security Checklist

- [ ] Change `JWT_SECRET` from the default (generate with `openssl rand -hex 32`)
- [ ] Change the default `admin` password after first login
- [ ] Run GroundControl behind HTTPS (Caddy/Nginx reverse proxy)
- [ ] If using password auth for VPS SSH, consider switching to key-based auth
- [ ] Review the terminal blocked commands list in `src/app/api/terminal/route.ts`
- [ ] The container mounts `/etc` read-write. It can read and potentially modify host system configs.
- [ ] Private SSH keys are stored in SQLite without encryption. Protect the database file.

---

## Troubleshooting

### "caddy: not found" in terminal

GroundControl uses `resolveBinary()` to find Caddy. If it's installed in a non-standard location, add it to the system `$PATH` for non-interactive shells, or symlink it to `/usr/local/bin/caddy`.

### "No containers mapped to this site"

Container-to-site matching uses:
1. The `reverse_proxy` target from the Caddyfile (hostname only, port stripped)
2. The domain name with TLD and `www` removed

If your container names don't match either pattern, rename the containers or update the Caddyfile proxy target.

### Deploy fails with "docker: unknown command: docker compose"

GroundControl auto-detects `docker compose` vs `docker-compose` when deploying. If both fail, ensure Docker Compose is installed on the VPS.

### Database locked / SQLite errors

In production, the container uses `file:/app/prisma/prod.db` on a named volume. Ensure the volume is not shared across multiple container instances.

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
| Container | Docker |
| Registry | GitHub Container Registry |
| CI/CD | GitHub Actions |

---

## License

MIT
