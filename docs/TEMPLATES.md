# Deployment Templates

## The Goal

GroundControl templates help you go from **"it works on my VPS"** to a **production-grade deployment** across all 7 layers of a real stack.

[→ View the full production stack diagram](./production-stack.html) (open in browser)

## The 7 Layers

Every production deployment needs these layers. Templates bundle them together.

| Layer | What it covers | Template handles |
|---|---|---|
| **1. Internet Edge** | DNS, CDN, WAF, DDoS | Cloudflare DNS records, proxied mode |
| **2. Security** | Auth, secrets, network, scanning | Auto-generated secrets, `.env.schema`, security headers |
| **3. Traffic** | Reverse proxy, load balancer | Caddy/Traefik/Nginx config with TLS |
| **4. Application** | Containers, DB, cache, storage | Docker Compose with images, volumes, ports |
| **5. Resilience** | Backups, auto-restart, healthchecks | restart: unless-stopped, healthcheck blocks, resource limits |
| **6. Observability** | Metrics, logs, alerting, uptime | Health endpoints, GroundControl monitoring integration |
| **7. CI/CD** | Pipeline, registry, migrations | GitHub repo connection, Convoy deploy labels |

## Available Templates

### `caddy-app-postgres` — Caddy + App + PostgreSQL
```
Internet → Cloudflare → Caddy → App Container → PostgreSQL
                                  ↓
                            Healthchecks
                            Auto-restart
                            Persistent volumes
                            Security headers
```
**Use for:** Web apps, APIs, SaaS backends that need a database.

**Inputs:** domain, app_port, db user/password/name

---

### `caddy-static-site` — Caddy + Static Site
```
Internet → Cloudflare → Caddy → Nginx (static files)
                                  ↓
                            Gzip + security headers
                            Auto-renewing TLS
```
**Use for:** Documentation sites, SPAs, landing pages, marketing sites.

**Inputs:** domain, app_slug, internal port

---

### `traefik-multi-app` — Traefik + Multiple Apps
```
Internet → Traefik (Dashboard + Let's Encrypt)
                ├── App 1 (app.example.com)
                ├── App 2 (api.example.com)
                └── App 3 (admin.example.com)
```
**Use for:** Microservices, multiple apps on one VPS, API + frontend separation.

**Inputs:** domain, acme_email, app_port

---

## How to Use

### From the UI
1. Go to **Templates** in the sidebar
2. Browse templates, select one
3. Fill in your details (domain, ports, etc.)
4. Preview the generated config
5. Deploy — GroundControl generates `docker-compose.yml`, proxy config, and `.env.schema`

### From the AI Co-Pilot
Ask the AI to help:
- *"Show me available templates"*
- *"Preview the Caddy + App + DB template for myapp.example.com"*
- *"Set up my existing app in /opt/myapp with the production template"*

### Migrating an Existing App
Templates support migration mode — upgrade an existing docker-compose setup to a production template:

1. AI detects your existing app via ProjectRuntime
2. Select a template to upgrade to
3. Preview the diff (what changes)
4. GC backs up your old compose file
5. Applies the new config, preserving data volumes

## Creating Custom Templates

Add `.yml` files to the `templates/` directory. Format:

```yaml
name: "My Custom Stack"
description: "What it does"
category: "web-app"  # web-app | static | microservices
version: "1.0"

requires:
  docker: true
  caddy: true  # or traefik, nginx

reverse_proxy:
  type: caddy
  sites:
    - domain: "{{domain}}"
      proxy_to: "{{app_container}}:{{app_port}}"

services:
  - name: app
    build: true
    ports: ["{{app_port}}"]
    env:
      - KEY={{value}}
    restart: unless-stopped

volumes:
  - data_volume

inputs:
  - name: domain
    prompt: "Your domain"
    example: "app.example.com"
  - name: app_port
    prompt: "App port"
    default: "3000"
```

Variables use `{{variable_name}}` syntax. Inputs support:
- `prompt` — shown to the user
- `default` — pre-filled value
- `generate: true` — auto-generate a secure random value
- `example` — shown as placeholder

## Roadmap

- [ ] One-click deploy — generate config AND run docker compose up
- [ ] Template marketplace — community contributed templates
- [ ] Multi-server templates — deploy across multiple VPS
- [ ] K3s/Kubernetes templates — full cluster setup
- [ ] Compliance templates — SOC2, HIPAA pre-configured stacks
- [ ] Backup integration — automatic S3/MinIO backup config
