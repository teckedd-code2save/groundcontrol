# GroundControl — Known Sharp Edges & Pending Work

This file tracks the known gaps, rough edges, and follow-up work from the four-phase "next-level deployment" push. It is meant to be a living list: pick an item, fix it, and remove or update its entry.

> Last updated: 2026-06-18

---

## Phase 1 — Foundation (Git build pipeline, deployment targets, auto-DNS)

| # | Edge | Impact | Fix size |
|---|------|--------|----------|
| 1.1 | **Preview tunnels require `cloudflared` on the VPS** | Preview URLs fail if `cloudflared` is not installed on the active host. | Small — auto-install in bootstrap or surface a clear warning. |
| 1.2 | **Custom-domain subdomain expects the full record name** (`api.example.com`) | Users may type `api` and expect the zone name to be appended automatically. | Small — auto-append the zone name, or validate/pre-fill. |
| 1.3 | **Static-site deploy assumes Caddy** | Fails on Nginx-only VPS layouts. | Small — detect proxy and emit the right site block. |
| 1.4 | **No background job queue** | Long deploys run as fire-and-forget async IIFEs; refreshing the page loses tracking. | Medium — introduce a job queue (BullMQ, in-memory queue, or SQLite-backed). |
| 1.5 | **No real-time log streaming** | Build/deploy output is buffered until each step ends. | Medium — stream logs via SSE/WebSocket instead of polling. |
| 1.6 | **Compose rollback is simplistic** | Just restarts the stack; it does not pin or roll back to the previous image. | Small — track image digests and rollback to a pinned image. |

---

## Phase 2 — k3s / Kubernetes

| # | Edge | Impact | Fix size |
|---|------|--------|----------|
| 2.1 | **k3s install blocked in container-local mode** | Host-package installs do not work when GroundControl itself runs inside Docker. | Medium — document the limitation or support remote-only k3s installs. |
| 2.2 | **Image import assumes Docker + k3s on the same host** | Multi-node k3s clusters will not see locally built images. | Medium — push to a registry instead of importing via `k3s ctr`. |
| 2.3 | **Default ingress class is Traefik** | Caddy-first users need a separate ingress controller. | Small — detect or let users pick ingress class (already exposed in UI). |
| 2.4 | **Preview tunnel defaults to host port 80** | May miss the ingress controller if it is not exposed on the host network. | Small — discover the ingress controller NodePort or host port. |
| 2.5 | **Quick tunnels are not auto-cleaned** | Zombie `cloudflared` processes can accumulate on the VPS. | Small — track PIDs and clean up on destroy/timeout. |
| 2.6 | **kubectl/helm install may need root** | Static binary install to `/usr/local/bin` can fail without root. | Small — fall back to `~/.local/bin` or warn. |

---

## Phase 3 — Cloud Run / Managed Targets

| # | Edge | Impact | Fix size |
|---|------|--------|----------|
| 3.1 | **Cloud Run builds require Docker buildx** | Falls back to `docker build + push`, but buildx is preferred. | Small — bootstrap buildx if missing. |
| 3.2 | **Defaults to Artifact Registry, not GCR** | Some users may expect `gcr.io` URIs. | Small — add a registry choice to the target config. |
| 3.3 | **AWS/Azure accounts have no adapters** | Modeled in the database but not usable as deploy targets. | Medium–Large each — build AWS Fargate and Azure Container Apps adapters. |
| 3.4 | **Service account key is duplicated per target** | Cloud Run targets embed the service-account JSON instead of referencing `CloudProviderAccount`. | Medium — let targets reference a cloud account by ID. |
| 3.5 | **No custom-domain integration for Cloud Run** | Only `*.run.app` URLs are returned. | Small — wire Cloudflare DNS to the Cloud Run service URL. |
| 3.6 | **No registry caching / layer reuse** | Rebuilds are slower than necessary. | Medium — enable BuildKit cache or use a remote cache. |

---

## Phase 4 — Terraform Control Plane

| # | Edge | Impact | Fix size |
|---|------|--------|----------|
| 4.1 | **AWS/Azure generators are placeholders** | Only Hetzner and GCP Cloud Run produce real HCL. | Medium–Large each — implement AWS EC2 and Azure VM generators. |
| 4.2 | **Terraform target does not auto-create a `VpsConfig`** | After provisioning a VPS, you still have to manually add it as a GroundControl connection. | Medium — auto-create/update a `VpsConfig` from `server_ip` output. |
| 4.3 | **Terraform must be manually installed on the active VPS** | Not bootstrapped yet. | Small — add Terraform to the Bootstrap / Install tab. |
| 4.4 | **Local state lives in `/tmp`** unless backed up | Risk of state loss on host restart. | Small — backup state to GC's DB or default to remote backend. |
| 4.5 | **No concurrent-operation locking** | Two users applying the same stack can race. | Small — add a simple lock (DB row or file lock). |
| 4.6 | **No drift detection / scheduled apply** | Infrastructure can drift silently. | Medium — scheduled job that runs `terraform plan` and alerts on changes. |

---

## Cross-cutting

| # | Edge | Impact | Fix size |
|---|------|--------|----------|
| C.1 | **No automated tests for new adapters/routes** | Regressions in deploy targets are easy to introduce. | Medium — add unit/integration tests for adapters and API routes. |
| C.2 | **AGENTS.md / README are now out of date** | Future agents and humans may not know the new tabs and features. | Small–Medium — update docs to match current UI/flow. |
| C.3 | **Error messages can leak internals** | Some route errors return raw stderr or internal paths. | Small — sanitize error responses before sending to the client. |
| C.4 | **Deploy pipeline is not idempotent everywhere** | Re-running some deploys can create duplicate resources or tunnel processes. | Small–Medium — add idempotency keys and cleanup. |

---

## Recommended next 3

1. **Background job queue + real-time logs** (1.4 + 1.5) — biggest UX and reliability win across all target types.
2. **Auto-create `VpsConfig` from Terraform `server_ip` output** (4.2) — closes the loop so Terraform-provisioned hosts are immediately manageable.
3. **Reference `CloudProviderAccount` from Cloud Run targets** (3.4) — cleaner security model and avoids duplicated secrets.

---

## How to update this file

When you fix an edge, either:

- Remove the row and note the PR/commit that fixed it, or
- Keep the row and add a `Status: fixed in <commit>` column.

Add new edges as they are discovered.
