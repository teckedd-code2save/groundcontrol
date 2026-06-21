# GroundControl Documentation

> Read these in order, or jump to what you need.

---

## 📖 Start here

- **[THE-HACK.md](./THE-HACK.md)** — the story of how GroundControl escaped its own Docker container to become a real VPS cockpit. Start here if you want to understand *why* this project is different.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — technical overview: execution model, data model, deployment targets, AI integration, and security notes.
- **[../README.md](../README.md)** — quick start, feature list, and project overview.

## 🚀 Run it

- **[../DEPLOY.md](../DEPLOY.md)** — complete production deployment: VPS → domain → Caddy → SSL → first login.
- **[../docker-compose.yml](../docker-compose.yml)** — the default compose file; no `--pid=host` required.

## 🎥 Show it off

- **[DEMO.md](./DEMO.md)** — a click-by-click script for recording a 2–4 minute demo.
- **[demo-data.md](./demo-data.md)** — seed fake data so the dashboard looks alive without a real server.

## 🧪 Test all integrations

- **[INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md)** — step-by-step guide for k3s, kubectl, Helm, Terraform, Cloudflare, and cloud accounts, plus a full end-to-end testing checklist.

## 🛠️ Reference

- `src/lib/docker-host-bridge.ts` — the container-to-host bridge implementation.
- `src/lib/host-exec.ts` — execution strategy chain.
- `src/lib/host-capabilities.ts` — host capability detection and verification.
- `src/lib/bootstrap.ts` — one-click installers for Docker, Caddy, k3s, kubectl, etc.
- `src/lib/deploy/targets/` — pluggable deployment targets.

---

> *GroundControl is a containerized app that learned how to drive the host. The docs above explain how.*
