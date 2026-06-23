> **Audience:** anyone running GroundControl who wants to understand why k3s broke Caddy, what the fix means, and what the architectural options are — without Kubernetes jargon.  
> **Companion:** [`INCIDENT-k3s-traefik-port-hijack.md`](./INCIDENT-k3s-traefik-port-hijack.md)  
> **Interactive version:** find walkthrough versions of this primer and the incident guide inside GroundControl at **Guides**.

# Caddy, k3s, and the Edge: A GroundControl Networking Primer

## 1. The story in one analogy

Imagine your server is an office building.

- **Caddy** is the professional doorman at the main entrance (`:80` and `:443`). He knows every tenant by name (`cloudie.serendepify.com`, `secrets.serendepify.com`), speaks HTTPS fluently, and hands visitors to the right apartment.
- **k3s** is a new apartment block you built *inside* the same building. It has its own internal mail system, elevators, and apartments (pods).
- **Traefik** is the apartment block's own doorman. k3s installed him by default.
- **ServiceLB / Klipper** is the sneaky part: it printed new directions in the lobby so visitors looking for the main entrance got redirected to Traefik instead. That's why every domain saw the *TRAEFIK DEFAULT CERT* — Caddy was still at his desk, but nobody reached him.

The fix was to remove Traefik's directions and tell k3s "you don't need a doorman; use Caddy."

This guide explains how that works, what else you can do, and when k3s is even the right choice in GroundControl.

---

## 2. Kubernetes services explained simply

When you run an app inside k3s, it lives in a **Pod**. Pods come and go; their IP addresses change. So Kubernetes has **Services** — stable addresses that point to the right pods.

There are three main ways to expose a Service. Think of them as levels of "publicness":

### 2.1 ClusterIP — internal phone extension

```
Internet  ✕  cannot reach this
   │
   ▼
k3s node
   └── Service: my-app (10.43.12.34:80)
        └── Pods: my-app-abc, my-app-def
```

- **Only reachable from inside the cluster.**
- Other pods can talk to it by name (`http://my-app`).
- From the host OS, you usually cannot reach it directly (it's on the cluster's internal network).
- **Use it for:** databases, internal APIs, anything that should never be touched from outside.

### 2.2 NodePort — a public door on a high-numbered port

```
Internet
   │
   ▼
k3s node :30080  ──►  Service: my-app  ──►  Pods
```

- Exposes the service on **every node** at a specific high port (default range `30000–32767`).
- From outside you hit `128.140.12.62:30080` and it reaches your app.
- **It does not use ports 80/443** unless you explicitly pick them (which k3s usually blocks because they are privileged).
- **Use it for:** giving Caddy (or another edge proxy) a stable back-end address to forward to.

### 2.3 LoadBalancer — a public address with normal ports

```
Internet :80 / :443
   │
   ▼
LoadBalancer (e.g. cloud LB, MetalLB, or k3s ServiceLB)
   │
   ▼
Service: my-app
   │
   ▼
Pods
```

- Asks for a real external IP and normal ports like `80` and `443`.
- In the cloud, this creates a real cloud load balancer.
- **In k3s default mode, this is where the trouble starts.** k3s has no cloud load balancer, so it uses **ServiceLB** (also called Klipper): it runs tiny privileged pods on the host network that DNAT `:80/:443` traffic into the cluster. That is what collided with Caddy.

---

## 3. What ServiceLB / Klipper actually does

ServiceLB is k3s's answer to "I asked for a LoadBalancer; give me one." It is simple and works without cloud credentials, but it is aggressive:

1. You create a Service of type `LoadBalancer` on ports 80/443.
2. k3s creates a DaemonSet called `svclb-<service-name>-*`.
3. Those pods run in the **host network namespace**, so they can bind host ports.
4. They insert **iptables DNAT rules** so packets to the node's IP on `:80/:443` are rewritten to the cluster's internal Traefik service.
5. Caddy, still listening on `:443`, never sees the original packet.

This is why simply having Caddy running was not enough. The hijack happened below Caddy, at the packet level.

---

## 4. What Traefik does

Traefik is an **ingress controller**: it reads Ingress resources (or Kubernetes CRDs) inside the cluster and routes incoming requests to the right pods. It is not evil; it is just another doorman.

When k3s installs Traefik by default, it also creates a `LoadBalancer` Service for it. That is the trigger for ServiceLB to steal the host ports.

You have three basic relationships available between Caddy and Traefik:

| Relationship | Meaning |
|---|---|
| **Caddy replaces Traefik** | Caddy is the only edge proxy. k3s apps are reached through NodePort/ClusterIP + Caddy upstream. |
| **Caddy fronts Traefik** | Caddy owns `:443` and proxies some domains to Traefik running on a different NodePort. |
| **Traefik replaces Caddy** | Traefik owns `:443`. Caddy is uninstalled or moved to a non-conflicting role. |

---

## 5. The architectural menu

Here are the realistic ways to run k3s on the same host as Caddy. None of them are wrong; they optimize for different things.

### Option 0: No k3s at all

```
Internet :443
   │
   ▼
Caddy (host)
   ├──► Docker Compose app on localhost:8091
   ├──► Static site served by Caddy
   └──► Infisical on localhost:8080
```

- **Best for:** most GroundControl users today. Simple, debuggable, no cluster magic.
- **Limitations:** no Kubernetes features (rolling deploys, auto-restart, horizontal scaling, configmaps, secrets management via kubectl).

### Option 1: Caddy edge + k3s without Traefik (recommended)

```
Internet :443
   │
   ▼
Caddy (host :443)
   ├──► Docker apps
   ├──► Static sites
   └──► myapp.serendepify.com ──► 127.0.0.1:30080 ──► k3s Service (NodePort) ──► Pods
```

- **How it works:** k3s runs, but Traefik is disabled. Each k3s app is exposed via `NodePort`. Caddy routes domains to `127.0.0.1:<nodeport>`.
- **Pros:** keeps Caddy as the single TLS terminator and single source of domain config. k3s apps get Kubernetes orchestration without stealing ports.
- **Cons:** you manually manage Caddy site blocks for k3s apps (GroundControl can automate this).
- **Current status:** this is what we applied as the fix.

### Option 2: Caddy edge + k3s with Traefik on custom ports

```
Internet :443
   │
   ▼
Caddy (host :443)
   │
   └──► k3s-*.serendepify.com ──► 127.0.0.1:30443 ──► Traefik (NodePort) ──► k3s Services
```

- **How it works:** leave Traefik installed, but expose it via a `NodePort` like `30443` instead of a `LoadBalancer`. Caddy proxies k3s domains to that NodePort.
- **Pros:** you keep the Kubernetes Ingress API; kubectl users can create Ingress resources and Traefik routes them.
- **Cons:** two proxies in the path; slightly more complex; Traefik still needs to be prevented from creating a LoadBalancer that steals `:443`.

### Option 3: k3s/Traefik as the edge

```
Internet :443
   │
   ▼
Traefik (k3s LoadBalancer on host :443)
   ├──► k3s Ingress apps
   └──► non-k3s apps? — now you have a problem
```

- **How it works:** Traefik owns `:443`. k3s manages all ingress.
- **Pros:** pure Kubernetes-native routing.
- **Cons:** your Docker apps and static sites now need to be brought *inside* k3s or exposed through Traefik somehow. You lose the simple Caddy file-based workflow GroundControl uses for static sites. Big migration.

### Option 4: k3s with MetalLB on a dedicated IP

```
Internet
   │
   ├──► 128.140.12.62:443 ──► Caddy (host)
   └──► 128.140.12.63:443 ──► Traefik/MetalLB (k3s)
```

- **How it works:** disable ServiceLB, install MetalLB, give it a separate IP address (e.g. the next IP in your subnet). Traefik's LoadBalancer gets that IP instead of the host IP.
- **Pros:** both Caddy and Traefik can own real `:443` on different IPs.
- **Cons:** needs multiple public IPs; your DNS has to split domains by IP; more moving parts.

---

## 6. What replaces what? What complements what?

| Component | Replaces | Complements | Conflicts with |
|---|---|---|---|
| **Caddy** | Traefik, NGINX, Apache as edge proxy | Docker Compose, static sites, NodePort k3s services | Another process on host `:80/:443` |
| **Traefik** | Caddy, NGINX Ingress as ingress controller | Kubernetes Ingress/CRD resources | Caddy when both want host `:80/:443` |
| **k3s ServiceLB** | cloud load balancers, MetalLB | Traefik LoadBalancer Service | Caddy on host ports |
| **MetalLB** | ServiceLB | Traefik LoadBalancer Service | Nothing, if given a unique IP pool |
| **NodePort** | LoadBalancer for direct access | Caddy as edge | Other services using the same high port |
| **ClusterIP** | direct pod access | everything internal | nothing external |

---

## 7. Safe experiments you can run

Everything here is reversible. Run them one at a time and check `curl -I https://cloudie.serendepify.com` after each step.

### Experiment A: see a NodePort in action

1. Deploy a tiny app to k3s from GroundControl (or apply this manually):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-k3s
spec:
  replicas: 1
  selector:
    matchLabels:
      app: hello-k3s
  template:
    metadata:
      labels:
        app: hello-k3s
    spec:
      containers:
        - name: hello
          image: rancher/hello-world
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: hello-k3s
spec:
  type: NodePort
  selector:
    app: hello-k3s
  ports:
    - port: 80
      targetPort: 80
```

2. Find the assigned NodePort:

```bash
kubectl get svc hello-k3s
```

3. Test it from the host:

```bash
curl http://127.0.0.1:<NODEPORT>
```

4. Add a Caddy route:

```caddy
hello-k3s.serendepify.com {
    reverse_proxy 127.0.0.1:<NODEPORT>
}
```

5. Reload Caddy and visit `https://hello-k3s.serendepify.com`.

### Experiment B: temporarily re-enable Traefik on a NodePort

If you want to feel how Option 2 works:

1. Keep the current config (`disable: traefik`) but manually install Traefik via Helm with a `NodePort` service on a high port.
2. Create a Kubernetes Ingress for `k3s-hello.serendepify.com`.
3. Add a Caddy upstream to `127.0.0.1:<TRAEFIK_NODEPORT>`.
4. Observe that Caddy still owns `:443` and Traefik only handles k3s routing.

### Experiment C: observe ServiceLB rules

If you ever re-enable Traefik as a LoadBalancer, watch the hijack happen:

```bash
# Before enabling Traefik
sudo iptables -t nat -L -n | grep -E ':80|:443'

# Enable Traefik (revert the fix)
sudo rm /etc/rancher/k3s/config.yaml
sudo systemctl restart k3s

# Check again
sudo iptables -t nat -L -n | grep -E ':80|:443'
sudo ss -tlnp | grep -E ':80\s|:443\s'
```

You will see new DNAT rules and a host-network `svclb-traefik` pod. To undo, re-apply the fix from the incident doc.

### Experiment D: use ClusterIP only

Deploy a workload with a `ClusterIP` Service and try to reach it from the host. It should fail from `127.0.0.1` — that proves it is truly internal. Then expose a second Service as `NodePort` and compare.

---

## 8. When is k3s the right choice in GroundControl?

GroundControl supports several ways to run an app. k3s is not automatically better; it is better for specific cases.

| You want... | Use |
|---|---|
| A simple blog or static site | **Static deploy target** (Caddy serves files) |
| A few containers with a `docker-compose.yml` | **Compose deploy target** |
| Managed, scale-to-zero hosting | **Cloud Run target** |
| Kubernetes features: rolling updates, self-healing pods, ReplicaSets, Helm charts, Ingress, configmaps/secrets | **k3s target** |
| To learn Kubernetes on your own hardware | **k3s target** |
| To provision a fresh VPS first | **Terraform target** |

### The "exclusive" case for k3s in GroundControl

The reason k3s exists in GroundControl is: **you want Kubernetes orchestration without needing a managed cloud cluster.**

It is exclusive in the sense that:

- It is the only target that gives you a real kube cluster on the host.
- It is the only target where GroundControl builds a Docker image, imports it into the cluster's container runtime, and applies Kubernetes manifests.
- It is the only target that supports Kubernetes-native patterns: `kubectl`, Ingress, ReplicaSets, rolling deployments, and Helm.

But it is **not exclusive in the sense of being required.** You can ignore k3s entirely and run production workloads with Compose + Caddy. Most of the current `serendepify.com` setup does exactly that.

---

## 9. My recommendation for your learning path

Given what just happened, here is a low-stress way to learn this without risking production again:

1. **Keep the current fix** (Caddy edge, no Traefik). Your sites stay up.
2. **Deploy one toy app to k3s via GroundControl** using a `NodePort` Service.
3. **Route a subdomain to it through Caddy** so you see the full path.
4. **Try the same app with a Kubernetes Ingress** (requires Traefik or another ingress controller on a NodePort).
5. **Once you are comfortable, decide:** do you want k3s workloads to be reachable through Caddy (Option 1), or do you want Traefik to manage k3s ingress behind Caddy (Option 2)?
6. **Only consider Option 3 or 4** if you outgrow the "Caddy fronting everything" model.

---

## 10. Glossary

| Term | Plain meaning |
|---|---|
| **Pod** | One or more containers running together in k3s. |
| **Service** | A stable address that points to a set of pods. |
| **ClusterIP** | A Service reachable only inside the cluster. |
| **NodePort** | A Service reachable on every node at a high port. |
| **LoadBalancer** | A Service that asks for a public IP + normal ports. |
| **ServiceLB / Klipper** | k3s's built-in way to fake a LoadBalancer by binding host ports. |
| **Ingress** | A Kubernetes resource that says "route domain X to service Y." |
| **Ingress controller** | The proxy that actually reads Ingress rules (Traefik, NGINX, Caddy). |
| **DNAT** | A firewall trick that rewrites the destination of a packet before it reaches the application. |
| **Edge proxy** | The first thing that sees traffic from the internet (usually on `:80/:443`). |

---

## Further reading

- [`INCIDENT-k3s-traefik-port-hijack.md`](./INCIDENT-k3s-traefik-port-hijack.md) — the original incident and fix
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — full GroundControl architecture
- [`src/lib/deploy/targets/kubernetes.ts`](../src/lib/deploy/targets/kubernetes.ts) — how GC deploys to k3s
- [k3s networking docs](https://docs.k3s.io/networking)
- [Kubernetes Services docs](https://kubernetes.io/docs/concepts/services-networking/service/)
