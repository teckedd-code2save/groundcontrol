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

GroundControl currently has two classes of templates:

- **Implemented templates** in `templates/*.yml`.
- **Planned combinations** from the production-stack model that still need schema and deploy-runner support.

### Implemented

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

### `nextjs-saas-postgres-redis` — Next.js + PostgreSQL + Redis
```
Internet → Cloudflare → Caddy → Next.js
                                  ├── PostgreSQL
                                  └── Redis
```
**Use for:** Next.js SaaS apps that need database-backed auth, caching, queues, or sessions.

**Inputs:** domain, app_port, database values, app secret

---

### `django-saas-postgres-redis` — Django + Worker + PostgreSQL + Redis
```
Internet → Cloudflare → Caddy → Django/Gunicorn
                                  ├── Worker
                                  ├── PostgreSQL
                                  └── Redis
```
**Use for:** Django apps with async jobs, static/media volumes, and Redis-backed cache/queue.

**Inputs:** domain, app_port, Django project, worker count, database values, app secret

---

### `rails-sidekiq-postgres-redis` — Rails + Sidekiq + PostgreSQL + Redis
```
Internet → Cloudflare → Caddy → Rails/Puma
                                  ├── Sidekiq
                                  ├── PostgreSQL
                                  └── Redis
```
**Use for:** Rails production apps with background jobs and persistent storage.

**Inputs:** domain, app_port, Rails master key, database values

---

### `fastapi-worker-postgres-redis` — FastAPI + Worker + PostgreSQL + Redis
```
Internet → Cloudflare → Caddy → FastAPI/Uvicorn
                                  ├── Worker
                                  ├── PostgreSQL
                                  └── Redis
```
**Use for:** Python API services with background workers, queues, and database state.

**Inputs:** domain, app_port, ASGI app, API workers, worker command, database values, app secret

---

### `monorepo-web-api-worker` — Web + API + Worker
```
Internet → Cloudflare → Caddy
                         ├── web.example.com → Web
                         └── api.example.com → API
                                            ├── Worker
                                            ├── PostgreSQL
                                            └── Redis
```
**Use for:** monorepos with separate frontend, API, and worker services.

**Inputs:** web domain, API domain, ports, service commands, database values

---

### `caddy-secure-microservices-observability` — Caddy + Microservices + Ops
```
Internet → Cloudflare → Caddy
                         ├── Web
                         ├── API → PostgreSQL / Redis / MinIO
                         ├── Worker
                         ├── Dozzle logs
                         └── Uptime Kuma
```
**Use for:** Caddy-first VPS deployments that need multiple app services, generated secrets, object storage, logs, and uptime checks in one stack.

**Inputs:** web/API/logs/uptime/storage domains, service commands, database/cache/object-storage secrets, ops credentials

---

### `traefik-scaled-microservices-observability` — Traefik + Scaled Microservices + Ops
```
Internet → Traefik
             ├── Web replicas
             ├── API replicas → PostgreSQL / Redis / MinIO
             ├── Worker
             ├── Traefik dashboard
             ├── Dozzle logs
             └── Uptime Kuma
```
**Use for:** Docker-label deployments where Traefik owns the edge and web/API services may be scaled with `docker compose up --scale web=3 --scale api=3`.

**Inputs:** web/API/Traefik/logs/uptime/storage domains, ACME email, Basic Auth users string, service commands, generated secrets

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

## Template Combinations to Add

These combinations come from the 7-layer stack in this doc and the Caddy/k3s networking guide. They should be added in phases because some need new template schema fields for `source`, `ingress`, `cloudflare`, `security`, `backup`, and `observability`.

### Edge, Ingress, and Domain Routing

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `caddy-cloudflare-proxied-app` | Cloudflare proxied DNS → Caddy → app | Default public app with Cloudflare CDN/WAF in front of Caddy | DNS plan must support proxied A/AAAA records |
| `caddy-cloudflare-tunnel-app` | Cloudflare hostname → named tunnel → app | Hosts where `80/443` should stay closed or are blocked | Tunnel config generation, DNS CNAME/public hostname routing |
| `caddy-cloudflare-access-app` | Cloudflare Access → tunnel/Caddy → app | Admin tools, internal dashboards, private apps | Access policy metadata and warning if not configured |
| `nginx-app-postgres` | Cloudflare/DNS → Nginx → app → PostgreSQL | Nginx-only VPS layouts | Nginx site generation, `nginx -t`, reload flow |
| `haproxy-load-balanced-app` | Cloudflare/DNS → HAProxy → app replicas | Multiple local app replicas on one VPS | HAProxy config generation and health checks |
| `traefik-labels-compose` | Traefik edge → Docker labels → app services | Users who prefer Docker-label routing | Safer Traefik ownership checks for host ports |

### Cloudflare Tunnel and Load-Balancing Modes

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `cloudflare-tunnel-single-service` | Named tunnel → one service | Simple private/public tunnel deployment | Write `cloudflared` ingress config and run connector |
| `cloudflare-tunnel-multi-service` | Named tunnel → multiple hostnames/services | Web + API + admin behind one tunnel | Multiple ingress rules and DNS routes |
| `cloudflare-tunnel-private-network` | WARP/private network → internal service | SSH/admin/internal-only networks | Private route metadata and explicit no-public-DNS mode |
| `cloudflare-lb-multi-origin` | Cloudflare Load Balancer → multiple VPS/tunnels | High availability across servers | Cloudflare pool/origin/monitor API support |
| `cloudflare-blue-green` | Cloudflare weighted routing → blue/green stacks | Safer cutovers and rollback | Weighted records/load-balancer pool updates |

### Kubernetes and Hybrid VPS Modes

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `k3s-caddy-nodeport-app` | Caddy edge → NodePort → k3s service | Recommended k3s mode for this project | Generate manifests plus Caddy site block |
| `k3s-caddy-traefik-nodeport` | Caddy edge → Traefik NodePort → k3s Ingress | Kubernetes-native Ingress without stealing `:443` | Traefik NodePort install/config guardrails |
| `k3s-metallb-traefik-edge` | Dedicated IP → MetalLB → Traefik | Separate Kubernetes edge IP | MetalLB IP pool inputs and DNS split by IP |
| `k3s-private-api-worker` | No public ingress → internal API/worker | Back-office workers and private APIs | Internal-only exposure and health probing |

### Data, Storage, and Backups

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `app-postgres-pgbouncer-redis` | App → PgBouncer → PostgreSQL + Redis | Higher connection counts on small VPSes | PgBouncer config and health checks |
| `postgres-backup-s3` | PostgreSQL → scheduled dumps → S3/R2/MinIO | Production backup baseline | Backup schedule, credentials, restore notes |
| `media-app-minio-postgres` | App → PostgreSQL + MinIO | Apps with user uploads/object storage | MinIO service and bucket/bootstrap inputs |
| `worker-queue-rabbitmq-postgres` | App/API → RabbitMQ workers → PostgreSQL | Durable job/event workloads | RabbitMQ service, management UI routing option |
| `analytics-clickhouse-app` | App/API → ClickHouse | Product analytics or event ingestion | ClickHouse volume/resource defaults |

### Observability and Operations

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `monitoring-prometheus-grafana` | Prometheus + Grafana + exporters | VPS and container monitoring | Exporter config, protected Grafana ingress |
| `logs-loki-promtail-grafana` | Promtail → Loki → Grafana | Centralized logs on one VPS | Bind mounts for Docker/journal logs |
| `uptime-kuma-caddy` | Caddy → Uptime Kuma | External health checks | Caddy site, persistent volume |
| `sentry-self-hosted-lite` | App → Sentry-compatible error capture | Error tracking baseline | Large stack warning and resource checks |

### Security and Compliance

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `private-admin-with-cloudflare-access` | Cloudflare Access → tunnel → admin app | Admin dashboards and internal tools | Access policy checklist/metadata |
| `infisical-secrets-stack` | Caddy → Infisical + database/cache | Self-hosted secrets management | Existing-service adoption and backup defaults |
| `trivy-scan-on-deploy` | Source/image → Trivy → deploy gate | Image vulnerability checks | Pre-deploy scanner step and policy thresholds |
| `soc2-baseline-webapp` | App + audit logs + backups + monitoring | Compliance-ready starter | Security headers, backups, monitoring, audit hooks |

### CI/CD and Registry

| Template | Path | Use for | Required engine work |
|---|---|---|---|
| `github-actions-ghcr-compose` | GitHub Actions → GHCR → compose pull/restart | Push-to-deploy without building on VPS | Registry auth and image digest tracking |
| `convoy-webhook-compose` | Git push/webhook → build/redeploy | Existing Convoy-style deployment labels | Webhook secret and deploy event handling |
| `cloudrun-cloudflare-domain` | Cloud Run → Cloudflare custom domain | Managed container hosting with Cloudflare DNS | Cloud Run domain mapping/DNS support |
| `multi-env-staging-prod` | staging + production domains/stacks | Teams shipping release environments | Environment naming, ports, DNS, secrets separation |

## Template Schema Gaps

To support the planned combinations cleanly, templates need these extra sections:

```yaml
source:
  types: [github, ghcr, local]
  required_files: [Dockerfile]
  build_context: "."
  dockerfile: "Dockerfile"

ingress:
  mode: caddy # caddy | nginx | traefik | tunnel | k3s-nodeport | private
  tls: auto
  sites:
    - domain: "{{domain}}"
      service: web
      port: "{{app_port}}"

cloudflare:
  dns:
    enabled: true
    record: A
    proxied: true
  tunnel:
    enabled: false
    ingress: []

security:
  headers: strict
  allow_ips: []
  cloudflare_access: false

observability:
  health_path: /health
  expected_status: 200

backups:
  enabled: false
  targets: []
```

Deploy should then produce a full plan: source verification, compose/manifests, proxy config, DNS records, tunnel config, security checks, health checks, and rollback notes.

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

- [ ] Source verification — validate GitHub/GHCR/local source against template requirements before deploy
- [ ] Proxy application — write and validate Caddy/Nginx/Traefik config, then reload safely
- [ ] Domain wiring — idempotent Cloudflare A/CNAME records with proxied/tunnel modes
- [ ] Cloudflare Tunnel templates — named tunnels, multi-hostname ingress, private-only mode
- [ ] Load-balancing templates — HAProxy, Traefik, and Cloudflare Load Balancing combinations
- [ ] K3s/Kubernetes templates — Caddy NodePort, Traefik NodePort, MetalLB dedicated-IP modes
- [ ] Backup integration — automatic S3/R2/MinIO backup config
- [ ] Template marketplace — community contributed templates
- [ ] Multi-server templates — deploy across multiple VPS
- [ ] Compliance templates — SOC2, HIPAA pre-configured stacks
