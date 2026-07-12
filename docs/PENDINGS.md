# GroundControl — Known Sharp Edges & Pending Work

This file tracks the known gaps, rough edges, and follow-up work from the four-phase "next-level deployment" push. It is meant to be a living list: pick an item, fix it, and remove or update its entry.

> **New:** For a step-by-step guide on installing and testing every integration, see [`INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md).

> Last updated: 2026-07-12

---

## Phase 5 — GroundControl Rehearsal

The proposed implementation and evaluation contract lives in [`REHEARSAL.md`](./REHEARSAL.md). The public website experience is a product preview, not a claim that these integrations are already live.

| # | Work | Impact | Fix size | Status |
|---|------|--------|----------|--------|
| 5.1 | **Seeded Rehearsal UI and feature flag** | Makes the workflow testable without implying a live provider integration. | Medium | specified |
| 5.2 | **Incident bundle, sanitizer, and evidence state machine** | Establishes the safety and audit boundary before external providers are added. | Large | specified |
| 5.3 | **Daytona sandbox adapter and deterministic reproduction** | Moves model-authored work away from production and requires a reproduced failure. | Large | specified |
| 5.4 | **Gemini investigation adapter and evidence gate** | Adds scoped diagnosis, tested candidate patches, and explicit abstention. | Large | specified |
| 5.5 | **Human-triggered draft PR and evaluation harness** | Turns verified evidence into a reviewable handoff and measures reliability. | Medium–Large | specified |

---

## Phase 1 — Foundation (Git build pipeline, deployment targets, auto-DNS)

| # | Edge | Impact | Fix size | Status |
|---|------|--------|----------|--------|
| 1.1 | **Preview tunnels require `cloudflared` on the VPS** | Preview URLs fail if `cloudflared` is not installed on the active host. | Small — auto-install in bootstrap or surface a clear warning. | pending |
| 1.2 | **Custom-domain subdomain expects the full record name** (`api.example.com`) | Users may type `api` and expect the zone name to be appended automatically. | Small — auto-append the zone name, or validate/pre-fill. | **fixed** `ec1c864` |
| 1.3 | **Static-site deploy assumes Caddy** | Fails on Nginx-only VPS layouts. | Small — detect proxy and emit the right site block. | pending |
| 1.4 | **No background job queue** | Long deploys run as fire-and-forget async IIFEs; refreshing the page loses tracking. | Medium — introduce a job queue (BullMQ, in-memory queue, or SQLite-backed). | **fixed** `ec1c864` |
| 1.5 | **No real-time log streaming** | Build/deploy output is buffered until each step ends. | Medium — stream logs via SSE/WebSocket instead of polling. | **fixed** `ec1c864` |
| 1.6 | **Compose rollback is simplistic** | Just restarts the stack; it does not pin or roll back to the previous image. | Small — track image digests and rollback to a pinned image. | pending |

---

## Phase 2 — k3s / Kubernetes

| # | Edge | Impact | Fix size | Status |
|---|------|--------|----------|--------|
| 2.1 | **k3s install blocked in container-local mode** | Host-package installs do not work when GroundControl itself runs inside Docker. | Medium — document the limitation or support remote-only k3s installs. | **mitigated** `36618ad` — host-exec strategy routes installs to host OS when possible |
| 2.2 | **Image import assumes Docker + k3s on the same host** | Multi-node k3s clusters will not see locally built images. | Medium — push to a registry instead of importing via `k3s ctr`. | pending |
| 2.3 | **Default ingress class is Traefik** | Caddy-first users need a separate ingress controller. | Small — detect or let users pick ingress class (already exposed in UI). | pending |
| 2.4 | **Preview tunnel defaults to host port 80** | May miss the ingress controller if it is not exposed on the host network. | Small — discover the ingress controller NodePort or host port. | pending |
| 2.5 | **Quick tunnels are not auto-cleaned** | Zombie `cloudflared` processes can accumulate on the VPS. | Small — track PIDs and clean up on destroy/timeout. | **mitigated** `aa1f759` — previous tunnel PID tracked and destroyed before new deploy |
| 2.6 | **kubectl/helm install may need root** | Static binary install to `/usr/local/bin` can fail without root. | Small — fall back to `~/.local/bin` or warn. | pending |
| 2.7 | **k3s install defaults bind Traefik LoadBalancer to host :80/:443** | Hijacks Caddy's edge ports and breaks all Caddy-fronted domains. See [`INCIDENT-k3s-traefik-port-hijack.md`](./INCIDENT-k3s-traefik-port-hijack.md) and the interactive [`k3s-traefik-incident`](./CADDY-K3S-NETWORKING-PRIMER.md) guide. | Small — disable Traefik in `installK3s` bootstrap config and default k3s targets to expose via NodePort + Caddy. | **mitigated** — incident documented and interactive recovery guide shipped; bootstrap default still pending |

---

## Phase 3 — Cloud Run / Managed Targets

| # | Edge | Impact | Fix size | Status |
|---|------|--------|----------|--------|
| 3.1 | **Cloud Run builds require Docker buildx** | Falls back to `docker build + push`, but buildx is preferred. | Small — bootstrap buildx if missing. | pending |
| 3.2 | **Defaults to Artifact Registry, not GCR** | Some users may expect `gcr.io` URIs. | Small — add a registry choice to the target config. | pending |
| 3.3 | **AWS/Azure accounts have no adapters** | Modeled in the database but not usable as deploy targets. | Medium–Large each — build AWS Fargate and Azure Container Apps adapters. | pending |
| 3.4 | **Service account key is duplicated per target** | Cloud Run targets embed the service-account JSON instead of referencing `CloudProviderAccount`. | Medium — let targets reference a cloud account by ID. | **fixed** `a44d325` |
| 3.5 | **No custom-domain integration for Cloud Run** | Only `*.run.app` URLs are returned. | Small — wire Cloudflare DNS to the Cloud Run service URL. | pending |
| 3.6 | **No registry caching / layer reuse** | Rebuilds are slower than necessary. | Medium — enable BuildKit cache or use a remote cache. | pending |

---

## Phase 4 — Terraform Control Plane

| # | Edge | Impact | Fix size | Status |
|---|------|--------|----------|--------|
| 4.1 | **AWS/Azure generators are placeholders** | Only Hetzner and GCP Cloud Run produce real HCL. | Medium–Large each — implement AWS EC2 and Azure VM generators. | pending |
| 4.2 | **Terraform target does not auto-create a `VpsConfig`** | After provisioning a VPS, you still have to manually add it as a GroundControl connection. | Medium — auto-create/update a `VpsConfig` from `server_ip` output. | **fixed** `dadc7d1` |
| 4.3 | **Terraform must be manually installed on the active VPS** | Not bootstrapped yet. | Small — add Terraform to the Bootstrap / Install tab. | **fixed** `36618ad` |
| 4.4 | **Local state lives in `/tmp`** unless backed up | Risk of state loss on host restart. | Small — backup state to GC's DB or default to remote backend. | pending |
| 4.5 | **No concurrent-operation locking** | Two users applying the same stack can race. | Small — add a simple lock (DB row or file lock). | pending |
| 4.6 | **No drift detection / scheduled apply** | Infrastructure can drift silently. | Medium — scheduled job that runs `terraform plan` and alerts on changes. | pending |

---

## Cross-cutting

| # | Edge | Impact | Fix size | Status |
|---|------|--------|----------|--------|
| C.1 | **No automated tests for new adapters/routes** | Regressions in deploy targets are easy to introduce. | Medium — add unit/integration tests for adapters and API routes. | **fixed** `aa1f759` — Vitest scaffold + 39 tests across adapters, manifests, generator, registry, runtime |
| C.2 | **AGENTS.md / README are now out of date** | Future agents and humans may not know the new tabs and features. | Small–Medium — update docs to match current UI/flow. | **fixed** `aab71c3` |
| C.3 | **Error messages can leak internals** | Some route errors return raw stderr or internal paths. | Small — sanitize error responses before sending to the client. | **fixed** `aa1f759` — `handleApiError` + credential redaction |
| C.4 | **Deploy pipeline is not idempotent everywhere** | Re-running some deploys can create duplicate resources or tunnel processes. | Small–Medium — add idempotency keys and cleanup. | **fixed** `aa1f759` — idempotency keys, DNS recordId tracking, preview tunnel cleanup |

---

## Recommended next 3 (updated)

1. **Rehearsal M0–M1** (5.1–5.2) — prove the operator flow, redaction boundary, and evidence model with deterministic adapters.
2. **Daytona reproduction slice** (5.3) — prove a selected incident can be reproduced safely away from production.
3. **Gemini investigation evaluation** (5.4) — benchmark evidence quality and abstention before adding PR creation.

Or, if you want the fastest demo polish:

1. **Auto-install cloudflared** (1.1) — removes a manual bootstrap step.
2. **Nginx support for static sites** (1.3) — broadens VPS compatibility.
3. **Remote Terraform state backup** (4.4) — protects state from `/tmp` loss.

---

## How to update this file

When you fix an edge, either:

- Remove the row and note the PR/commit that fixed it, or
- Keep the row and add a `Status: fixed in <commit>` column.

Add new edges as they are discovered.
