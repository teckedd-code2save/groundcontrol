# IDEAS — GroundControl Feature & Research Roadmap

Forward-looking ideas for GroundControl, the self-hosted VPS operations cockpit.

---

## Intelligence Layer

1. **Anomaly detection on live metrics** — train a lightweight model on historical container CPU/mem/net patterns to flag deviations before they become incidents, surfaced in the Alerts panel.

2. **Root-cause suggestions from alert chains** — when multiple alerts fire in a window (e.g., disk full → container OOM → proxy 502), correlate them into a single synthesis instead of showing N independent warnings.

3. **Capacity forecasting** — based on 7/30-day resource trends, predict when the VPS will run out of disk, memory, or inodes, and suggest pre-emptive remediation (log rotation, volume expansion, image cleanup).

4. **Change-intent graph memory** — persist the dependency graph across sessions so the system remembers "the last time we restarted Caddy, these 3 containers lost connectivity" and surfaces that history during the next plan step.

5. **Drift detection** — compare the live VPS state (containers, networks, mounts) against the last-known-good snapshot and flag unexpected differences without a formal deployment running.

---

## Deployment & Orchestration

6. **Blue-green swap for compose targets** — instead of in-place restart, spin up the new stack alongside the old one, run a health probe, and swap the proxy upstream in one atomic Caddy reload.

7. **Rollback preview with diff** — before rolling back, show the exact config diff (env vars, image tags, compose overrides) between the current and target deployment so the operator doesn't roll back blind.

8. **Multi-VPS deployment groups** — deploy the same compose project across two or more VPS instances (e.g., staging→production promotion), with shared context but independent rollback state.

9. **Terraform plan visualization** — render `terraform plan` output as an interactive topology diff (resources added/changed/destroyed) instead of raw HCL text, making infrastructure changes readable at a glance.

10. **Helm chart support** — add a `helm` deploy adapter for users who manage Kubernetes clusters alongside their VPS fleet, with namespace-scoped rollback.

---

## Monitoring & Observability

11. **Log tail with structured search** — a thin log viewer in the Terminal panel that streams container logs and supports grep-style filtering, time-window selection, and bookmarking.

12. **Uptime check pings** — integrate a simple HTTP health-checker that pings deployed projects every 60s and surfaces the response status (200/4xx/5xx/timeout) on the Dashboard.

13. **Caddy access log analytics** — parse Caddy's structured JSON access logs to surface top 404 paths, slowest routes, client IP distribution, and TLS handshake failures in the reverse proxy panel.

14. **Disk usage breakdown** — a tree-map view of the VPS filesystem showing per-directory disk consumption so users can find what's eating space without SSHing in.

15. **Backup status dashboard** — surface the last successful backup timestamp, backup size, and next-scheduled run for any backup strategy the user configures (cron + rsync, rclone to S3, etc.).

---

## Developer Experience

16. **Template marketplace** — a curated gallery of deploy templates (Next.js + Postgres, Django + Gunicorn, static SPA, Wordpress stack) that users can one-click apply and customize.

17. **CLI-first mode** — expose the full GroundControl API surface as a `gc` CLI so users can check status, trigger deployments, and view logs without opening the browser.

18. **Webhook triggers** — call an external webhook on key events (deploy started, deploy completed, rollback occurred, alert fired) for integration with Slack, Discord, or custom pipelines.

19. **GitOps sync** — watch a GitHub repo for changes to `docker-compose.yml` or deploy config and auto-sync the project, optionally with a manual-approval gate.

20. **Terraform module library** — ship reusable Terraform modules (Hetzer VPS, Cloudflare DNS, Postgres RDS) as part of the infrastructure panel so users don't start from scratch.

---

## Platform & Ecosystem

21. **Plugin SDK** — a documented API for third-party deploy adapters, probe types, and notification channels so the community can extend GroundControl without forking the core.

22. **Multi-user with RBAC** — team accounts with viewer/operator/admin roles, shared VPS connections, and audit-logged actions (who deployed what and when).

23. **Cloud marketplace image** — publish a pre-configured GroundControl AMI/Droplet Image/Vultr snapshot so new users spin up in minutes with a working stack.

24. **OIDC / SSO login** — replace the basic-auth gate with OpenID Connect so teams can log in via Google Workspace, GitHub, or any OIDC provider.

25. **Metrics export (Prometheus / OpenTelemetry)** — expose a `/metrics` endpoint so GroundControl itself can be scraped by an external monitoring stack, closing the observability loop.
