# Self-host GroundControl

GroundControl is designed to run **on the VPS it manages**, either in Docker or directly with Node.js. This guide walks through a complete production deployment: VPS → domain → reverse proxy → SSL → first login.

> **Single-tenant by design.** Each GroundControl instance has its own SQLite database on its own host. If you share GroundControl with a friend, they run their own instance on their own VPS — their data never sits in your database.

---

## What you need

- A VPS with root or passwordless-sudo access (Ubuntu 22.04/24.04, Debian 12, or similar).
- Docker + Docker Compose installed on the VPS.
- A domain or subdomain you control (e.g. `groundcontrol.yourdomain.com`).
- DNS `A` record pointing that subdomain to your VPS IP.
- (Optional) A Cloudflare account if you want Cloudflare DNS / tunnels from the UI.

---

## 1. Prepare the VPS

SSH into your server and install Docker if it is not already present:

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Create a directory for GroundControl:

```bash
sudo mkdir -p /opt/groundcontrol
sudo chown $USER:$USER /opt/groundcontrol
cd /opt/groundcontrol
```

---

## 2. Clone and configure

```bash
git clone https://github.com/teckedd-code2save/groundcontrol.git .
cp .env.example .env
```

Generate a strong JWT secret and add it to `.env`:

```bash
printf 'JWT_SECRET="%s"\n' "$(openssl rand -hex 32)" >> .env
```

Also set the site URL for the app:

```bash
# .env
NEXT_PUBLIC_SITE_URL=https://groundcontrol.yourdomain.com
```

> The database (`prisma/dev.db`) lives inside the `groundcontrol-db` Docker volume. Back it up regularly from **Settings → Security → Database Backup & Restore**.

---

## 3. Start GroundControl

```bash
docker compose up -d
```

The compose file exposes the app on host port `3003` bound to `127.0.0.1`. It does **not** require `--pid=host` or `--privileged`; GroundControl uses the mounted Docker socket to spawn a one-shot privileged helper container when it needs to run commands on the host OS. See [`docs/THE-HACK.md`](./docs/THE-HACK.md) for how this works.

Check it is healthy:

```bash
docker compose ps
docker compose logs -f app
```

---

## 4. Put it behind Caddy (reverse proxy + SSL)

Install Caddy on the host (not inside the GroundControl container):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Create a Caddy site config:

```bash
sudo mkdir -p /etc/caddy/sites
sudo tee /etc/caddy/sites/groundcontrol.caddy > /dev/null <<'EOF'
groundcontrol.yourdomain.com {
    reverse_proxy localhost:3003
}
EOF
```

Reference it from the main Caddyfile:

```bash
echo 'import /etc/caddy/sites/*.caddy' | sudo tee /etc/caddy/Caddyfile
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy will automatically provision and renew an HTTPS certificate for your domain.

---

## 5. Using Cloudflare for DNS / proxy

### Cloudflare DNS only
Point your subdomain `A` record to the VPS IP, make sure the orange-cloud proxy is **off** during first setup (Caddy needs direct HTTP validation), then you can turn it back on.

### Cloudflare Tunnel
If you prefer not to expose ports, create a Cloudflare tunnel and install `cloudflared` on the VPS:

```bash
# Download cloudflared
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /tmp/cloudflared
sudo install /tmp/cloudflared /usr/local/bin/cloudflared

# Authenticate (follow the URL printed)
cloudflared tunnel login

# Create and run a tunnel
cloudflared tunnel create groundcontrol
cloudflared tunnel route dns groundcontrol groundcontrol.yourdomain.com
cloudflared tunnel run groundcontrol
```

You can also manage tunnels from **Settings → Cloudflare** once GroundControl is running.

---

## 6. First-run setup

Open `https://groundcontrol.yourdomain.com`. On a fresh database you are redirected to `/setup` to create the first admin account. Choose a strong password — it must be at least 12 characters with uppercase, lowercase, number, and symbol.

Then complete the onboarding wizard:

1. **Connections** — choose *This server* if GroundControl is running on the managed VPS, or add an SSH connection to a remote host.
2. **Test connection** — GroundControl checks Docker, Caddy, Nginx, and common paths.
3. **Auto-detect layout** — accepts detected paths or tweak them in **Settings → Server Layout**.

---

## 7. Direct Node.js deployment (advanced)

If you do not want Docker:

```bash
# On the VPS
cd /opt/groundcontrol
npm install
npx prisma migrate deploy
npm run build
JWT_SECRET=$(openssl rand -hex 32) npm run start
```

Use systemd, pm2, or similar to keep the process alive, and proxy port `3000` through Caddy.

---

## 8. Updating

Pull the latest code and rebuild:

```bash
cd /opt/groundcontrol
git pull origin main
# If the image changed
docker compose pull
docker compose up -d --build
npx prisma migrate deploy
```

The SQLite volume preserves your database across updates.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `Unauthorized` after login | `JWT_SECRET` is missing or changed. Set a stable secret in `.env`. |
| Database locked / migrate fails | Stop the app, run `npx prisma migrate deploy`, then restart. |
| Cannot see Docker containers | Make sure `/var/run/docker.sock` is mounted and the Docker user has permissions. |
| Caddy shows blank page | Verify `NEXT_PUBLIC_SITE_URL` matches the public URL. |
| Cloudflare tunnel not connecting | Check `cloudflared` is running and the tunnel DNS record exists. |

For local development, see [CONTRIBUTING.md](./CONTRIBUTING.md).
