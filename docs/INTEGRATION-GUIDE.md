# GroundControl Integration Guide

> How to install, configure, and test k3s, kubectl, Helm, Terraform, Cloudflare, and cloud accounts in GroundControl.

---

## k3s vs kubectl — what is each for?

| Tool | What it is | What GC uses it for |
|---|---|---|
| **k3s** | A lightweight Kubernetes distribution that installs a full cluster on a single VPS (or many). | GC installs k3s to give you a Kubernetes target for projects. When you deploy a project with target **k3s**, GC builds an image, generates K8s manifests, and applies them to the cluster. |
| **kubectl** | The command-line client for talking to *any* Kubernetes cluster — k3s, EKS, GKE, AKS, etc. | GC uses `kubectl` to inspect namespaces, pods, services, and ingresses on the active host. It also uses `kubectl` to apply manifests when deploying to the k3s target. |
| **Helm** | A package manager for Kubernetes charts. | GC uses Helm to install ingress controllers, cert-manager, monitoring stacks, or third-party charts as part of project/bootstrap flows. |

In short: **k3s is the server**, **kubectl is the remote**, **Helm is the app installer**.

You do not *need* k3s to use kubectl. If you already have a Kubernetes cluster elsewhere and can reach it from the active VPS, GC can use `kubectl` against it. But the default GC flow assumes k3s is installed on the active VPS because that is the simplest self-hosted path.

---

## Kubernetes workflow in GC

### 1. Install k3s

1. Go to **Services → Install**.
2. Click **k3s**.
3. GC installs k3s on the active VPS and writes a kubeconfig to `/etc/rancher/k3s/k3s.yaml`.
4. Verify from the terminal:
   ```bash
   kubectl get nodes
   ```

### 2. Install kubectl (and optionally Helm)

1. In **Services → Install**, click **kubectl** and **helm**.
2. GC downloads the static binaries to `/usr/local/bin`.
3. Verify:
   ```bash
   kubectl version --client
   helm version
   ```

### 3. Deploy a project to k3s

1. Go to **Services → Projects**.
2. Create or edit a project.
3. Set **Deploy target** to `k3s`.
4. GC builds a Docker image, generates Kubernetes manifests (deployment, service, ingress), and applies them with `kubectl apply -f`.
5. Check **Services → Projects → Deployments** for status, or inspect pods in the terminal:
   ```bash
   kubectl get pods -n <project-namespace>
   ```

### 4. Inspect the cluster

GC has read-only API routes for:
- `/api/k8s/namespaces`
- `/api/k8s/pods`
- `/api/k8s/services`
- `/api/k8s/ingresses`

These are used by the topology and AI assistant. The AI can answer questions like "why is my pod crashing?" because its tools run `kubectl` on the host.

---

## Terraform workflow in GC

GroundControl has a built-in Terraform control plane for provisioning VPS infrastructure before deploying applications.

### What it is good for

- Spinning up a new VPS on Hetzner / GCP / AWS / Azure.
- Creating the machine GC will later manage as an active connection.
- Keeping infrastructure code in the same place as deploy code.

### How to use it

1. **Install Terraform** from **Services → Install**.
2. Go to **Settings → Infrastructure** (or **Services → Infrastructure**).
3. Click **New stack**.
4. Pick a provider (Hetzner, GCP, AWS, Azure).
5. Fill in variables: region, machine type, SSH key name, etc.
6. Click **Generate** to produce HCL.
7. Click **Plan** to preview changes.
8. Click **Apply** to create the infrastructure.
9. After apply, GC reads the `server_ip` output and can auto-create a `VpsConfig` connection for the new machine.

### Cloud credentials

For GCP / AWS / Azure stacks, add the cloud account in **Settings → Cloud Accounts** first. Terraform uses those credentials at apply time. Hetzner uses an API token added in the stack variables.

---

## Cloudflare workflow in GC

Cloudflare integration handles DNS and preview tunnels.

### DNS

1. Go to **Settings → Cloudflare**.
2. Add a Cloudflare account token (encrypted at rest).
3. Mark one account as **active**.
4. GC lists zones and lets you pick one.
5. When deploying a project with a custom domain, GC can create/update the DNS A/CNAME record automatically.

### Preview tunnels

1. Install `cloudflared` from **Services → Install**.
2. When deploying a project, enable **Preview URL**.
3. GC starts a `cloudflared tunnel` for the deployment and returns a `*.trycloudflare.com` URL.
4. Tunnels are cleaned up when the deployment is destroyed or superseded.

### Cloudflare Tunnels (persistent)

1. In **Services → Cloudflare**, create a tunnel.
2. GC runs `cloudflared tunnel create` and stores the credentials.
3. Configure ingress rules to route traffic to local services.

---

## Cloud accounts workflow

Cloud accounts store encrypted credentials for managed-cloud deploy targets.

1. **Settings → Cloud Accounts**.
2. Add GCP service-account JSON, AWS access keys, or Azure credentials.
3. Mark the account active or reference it by ID in deploy targets.
4. Cloud Run deploys (GCP) and Terraform stacks consume these accounts.

### Cloud Run deploy target

1. **Settings → Deploy Targets** → create a `cloudrun` target.
2. Pick a GCP cloud account.
3. Pick a project and region.
4. In **Services → Projects**, set the project deploy target to `cloudrun`.
5. GC builds the image, pushes to Artifact Registry, and deploys the service.

### AWS / Azure targets

Currently modeled in the database but adapters are not fully implemented. See `docs/PENDINGS.md`.

---

## Helm workflow in GC

Helm is used as a helper for k3s bootstrapping.

1. Install Helm from **Services → Install**.
2. Use the terminal or AI assistant to run Helm commands on the host:
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm install ingress-nginx ingress-nginx/ingress-nginx
   ```
3. GC's AI tools can run Helm commands for you; mutating operations require confirmation.

---

## End-to-end testing checklist

Use this list to verify each integration works. Fix anything that fails before moving to the next item.

### Bootstrap / Install tab

- [ ] **Docker** installs successfully on the active VPS.
- [ ] **Git** installs and `git --version` returns a version.
- [ ] **Caddy** installs and `caddy version` returns a version.
- [ ] **Nginx** installs (or static binary fallback works) and `nginx -v` returns a version.
- [ ] **k3s** installs and `kubectl get nodes` shows a Ready node.
- [ ] **kubectl** installs and `kubectl version --client` works.
- [ ] **Helm** installs and `helm version` works.
- [ ] **Terraform** installs and `terraform version` works.
- [ ] **cloudflared** installs and `cloudflared version` works.
- [ ] **Node** installs and `node --version` works.

### Terminal

- [ ] `caddy version` returns the host version.
- [ ] `nginx -v` returns the host version.
- [ ] `git --version` returns the host version.
- [ ] `kubectl get nodes` returns cluster nodes.
- [ ] `docker ps` lists host containers.
- [ ] `systemctl status caddy` (or `rc-service caddy status` on Alpine) works.
- [ ] `terraform version` returns the host version.

### Containers / Proxy

- [ ] **Services → Containers** lists Docker containers on the host.
- [ ] Start/stop/restart a container from the UI works.
- [ ] **Services → Proxy** can create a Caddy site block.
- [ ] The site block appears in `/etc/caddy/Caddyfile` on the host.
- [ ] Caddy reloads successfully.

### Projects / Deploy

- [ ] Create a project with target **compose** and deploy it.
- [ ] Verify `docker compose ps` on the host shows the stack.
- [ ] Create a project with target **static** and deploy it.
- [ ] Verify files land in `/var/www/<project>`.
- [ ] Create a project with target **k3s** and deploy it.
- [ ] Verify `kubectl get pods -n <project>` shows running pods.
- [ ] Create a project with target **cloudrun** (requires GCP account) and deploy it.
- [ ] Verify the service appears in Google Cloud Console.

### Cloudflare

- [ ] Add a Cloudflare API token in **Settings → Cloudflare**.
- [ ] Account is marked active and zones load.
- [ ] Deploy a project with a custom domain; GC creates the DNS record.
- [ ] Enable preview URL on a deploy; the `*.trycloudflare.com` link works.
- [ ] Create a persistent tunnel in **Services → Cloudflare**.

### Terraform

- [ ] Install Terraform.
- [ ] Create a stack in **Settings → Infrastructure**.
- [ ] Generate HCL for the chosen provider.
- [ ] Plan succeeds (or fails with a clear, actionable error).
- [ ] Apply succeeds and creates the resource.
- [ ] A `VpsConfig` is auto-created from the `server_ip` output (Hetzner/GCP path).
- [ ] Destroy succeeds and cleans up resources.

### Cloud Accounts

- [ ] Add a GCP service account in **Settings → Cloud Accounts**.
- [ ] Test connection succeeds.
- [ ] Add AWS credentials.
- [ ] Add Azure credentials.
- [ ] Cloud Run deploy consumes the GCP account.

### Alerts

- [ ] Create an alert rule in **Settings → Alerts**.
- [ ] Trigger the condition manually (e.g., start a process that uses memory).
- [ ] Verify an alert is created.
- [ ] Click **Investigate**; the AI assistant opens with a pre-filled query.

### AI Assistant

- [ ] Ask "is git installed?" — it checks the host and answers correctly.
- [ ] Ask "restart caddy" — it confirms, then runs the command on the host.
- [ ] Ask "show me the pods" — it returns `kubectl get pods` output from the host.
- [ ] Ask "deploy my project" — it walks through the deploy flow.

---

## Troubleshooting

### "command not found" in terminal or install tab

1. Check **Settings → Server Layout** and ensure the OS/init system are auto-detected correctly.
2. Run `run_diagnostic` with `command -v <binary>` from the AI chat. It should now route through the Docker host bridge.
3. Try installing the tool from **Services → Install**.
4. Check `/usr/local/bin` on the host — static binaries land there.

### k3s deploy fails

1. `kubectl get nodes` — is the node Ready?
2. `kubectl get pods -n <project>` — are images pulling? If `ImagePullBackOff`, the image may not have been imported. Run `k3s ctr images ls | grep <image>`.
3. Check ingress class. k3s ships Traefik by default. If you want NGINX ingress, install it with Helm.
4. For multi-node clusters, images must be pushed to a registry; local import only works on single-node k3s.

### Terraform plan/apply fails

1. Verify Terraform is installed on the active VPS.
2. Verify credentials are configured (Hetzner token, GCP account, etc.).
3. Check the generated HCL for provider-specific mistakes.
4. Look at stderr in the UI; raw Terraform output is shown.

### Cloudflare DNS not created

1. Token must have **Zone:Edit** and **DNS:Edit** permissions.
2. The zone must already exist in Cloudflare.
3. Subdomain must be the full record name (`api.example.com`, not `api`).

---

## See also

- [`docs/PENDINGS.md`](./PENDINGS.md) — known gaps and sharp edges
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture
- [`docs/THE-HACK.md`](./THE-HACK.md) — how GC reaches the host OS from inside Docker
