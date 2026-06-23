> **Incident date:** 2026-06-22  
> **Duration:** ~47 hours (from k3s install until fix)  
> **Affected services:** `cloudie.serendepify.com`, `secrets.serendepify.com`, and all other Caddy-fronted domains on the host.  
> **Severity:** High — all HTTPS traffic returned 404 with the Traefik default certificate.  
> **Primer:** if the Kubernetes terms below are unfamiliar, read [`CADDY-K3S-NETWORKING-PRIMER.md`](./CADDY-K3S-NETWORKING-PRIMER.md) first.  
> **Interactive version:** you can walk through this incident step-by-step inside GroundControl at **Guides → Recovering from a k3s Traefik port hijack**. The AI assistant knows which step you are on.

# When k3s Hijacked Port 443: A Caddy vs. Traefik Incident

## Summary

A routine k3s installation on the GroundControl host silently installed a bundled Traefik ingress controller exposed as a `LoadBalancer`. k3s's default ServiceLB (Klipper) implementation claimed the host's `:80` and `:443` ports via iptables DNAT. Because the host already used Caddy as the edge reverse proxy on those same ports, every HTTPS request was intercepted by Traefik before it reached Caddy. All production domains returned `404 Not Found` with the **TRAEFIK DEFAULT CERT**, even though the underlying apps were healthy.

This document explains the mechanism, the fix, and the architectural guardrails that prevent it from happening again.

---

## Timeline

| Time (approx.) | Event |
|---|---|
| T-47h | k3s installed on the host with the default k3s.io installer. |
| T-47h → T0 | All Caddy-fronted domains gradually became unreachable with a Traefik default certificate. |
| T0 | Reported outage: `cloudie.serendepify.com` returns 404 + TRAEFIK DEFAULT CERT. |
| T0+10m | Confirmed host Caddy was running and holding the `:443` socket. |
| T0+15m | Confirmed k3s's `svclb-traefik-*` pod was DNAT-ing `:80/:443` to the cluster's Traefik. |
| T0+20m | Disabled Traefik in k3s config, removed the leftover HelmChart/service/svclb, and restarted k3s. |
| T0+25m | Verified `:443` was freed; Caddy served valid Let's Encrypt certs again. |
| T0+30m | Discovered `secrets.serendepify.com` containers were also gone; restored the Infisical stack. |
| T0+35m | All services returned 200 with the correct certificates. |

---

## Root cause

k3s ships several components by default that look harmless in isolation but collide with a host-level edge proxy:

1. **Bundled Traefik** — installed as the default ingress controller.
2. **ServiceLB / Klipper** — a lightweight LoadBalancer implementation that runs a host-network pod for every `LoadBalancer` service.
3. **iptables DNAT** — each `svclb-*` pod inserts rules that redirect traffic destined for the host's public IP on the service ports to the cluster's Service CIDR.

The result on this host:

```bash
$ kubectl get svc -n kube-system traefik
NAME      TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)
traefik   LoadBalancer   10.43.169.30   128.140.12.62  80:31729/TCP,443:32628/TCP
```

```bash
$ sudo iptables -t nat -L -n | grep -E ':80|:443'
DNAT       tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:80  to:10.43.x.x:80
DNAT       tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:443 to:10.43.x.x:443
```

Caddy still held the socket, but packets were rewritten before they got there. Traefik, knowing nothing about the host's domains, served its default certificate and a 404 for every request.

---

## Verification commands

To confirm the same problem on another host:

```bash
# 1. Check what is listening on 80/443
sudo ss -tlnp | grep -E ':80\s|:443\s'

# 2. Check for k3s ServiceLB pods holding host ports
kubectl get pods -n kube-system -l svccontroller.k3s.cattle.io/svcname=traefik

# 3. Check the Traefik service type
kubectl get svc -n kube-system traefik

# 4. Check iptables DNAT rules
sudo iptables -t nat -L -n | grep -E ':80|:443'

# 5. Test the real edge from outside the host
curl -I -k https://<your-domain>/
# A healthy Caddy host returns your site's cert.
# A hijacked host returns "TRAEFIK DEFAULT CERT".
```

---

## The fix

The durable fix keeps k3s running for cluster workloads but removes its claim on the host edge ports.

### 1. Disable Traefik at install or runtime

Create or append to `/etc/rancher/k3s/config.yaml`:

```yaml
disable:
  - traefik
```

If k3s is already installed, restart it:

```bash
sudo systemctl restart k3s
```

### 2. Remove the leftover Traefik resources

```bash
# Delete the HelmChart so it does not recreate Traefik
kubectl delete helmchart -n kube-system traefik

# Delete the LoadBalancer service and its svclb pods
kubectl delete svc -n kube-system traefik
kubectl delete daemonset -n kube-system svclb-traefik
```

### 3. Verify the host edge is free

```bash
sudo ss -tlnp | grep -E ':80\s|:443\s'
# Should show Caddy (or nothing until Caddy reloads).

sudo iptables -t nat -L -n | grep -E ':80|:443'
# Should show no DNAT rules pointing into the cluster.
```

### 4. Reload Caddy

```bash
sudo systemctl reload caddy
```

Production domains came back instantly with the real Let's Encrypt certificates.

---

## Why this is reversible

Disabling Traefik only removes k3s's bundled ingress controller. It does not:

- Stop k3s or the kubelet.
- Remove running cluster workloads.
- Delete the k3s node or kubeconfig.
- Affect Docker containers running outside k3s.

If a workload later needs an in-cluster ingress, you can install Traefik (or NGINX Ingress, or Caddy as an in-cluster ingress) on a different NodePort range and route Caddy to it explicitly.

---

## Recommended architecture going forward

The host is committed to **Caddy as the edge reverse proxy** on `:80` and `:443`. k3s must not claim those ports. The clean coexistence pattern is:

```
Internet ──► Caddy (host :80/:443, TLS termination) ──► upstreams
                              │
                              ├──► Docker apps on localhost ports
                              ├──► Static sites served by Caddy
                              └──► k3s workloads via NodePort or ClusterIP + Caddy upstream
```

### For k3s workloads that need public access

Expose them inside the cluster on a **NodePort** or **ClusterIP**, then add a Caddy site block that proxies to it:

```caddy
myapp.serendepify.com {
    reverse_proxy 127.0.0.1:30080
}
```

Or proxy to the cluster's Service CIDR through the host network if routing is available.

### What GroundControl should do

1. **Disable Traefik by default in the k3s bootstrap.**  
   The `installK3s` helper in `src/lib/bootstrap.ts` should write `disable: [traefik]` to `/etc/rancher/k3s/config.yaml` before running the installer. A user who wants k3s-managed ingress can opt in explicitly.

2. **Expose `ingressClass` as a target-level choice, defaulting to `caddy`.**  
   When a project deploys to k3s, GroundControl should generate a Caddy site block on the host that routes to the workload's NodePort/ClusterIP instead of assuming Traefik will handle ingress.

3. **Add a port-conflict health check.**  
   Extend `src/lib/server-probe.ts` or the alert evaluator to detect when something other than Caddy is bound to `:80` or `:443`, or when k3s ServiceLB pods are present on the host network.

4. **Document the Caddy-first assumption in deploy guides.**  
   Make it explicit that GroundControl expects Caddy to own the edge ports and that enabling another LoadBalancer on the same host will break routing.

---

## Lessons learned

- **Socket ownership is not packet ownership.** Caddy holding `:443` did not mean traffic reached Caddy. iptables DNAT can redirect packets before they hit userspace.
- **Default k3s is hostile to existing edge proxies.** The k3s installer is one command, but its defaults assume it owns the host network edge.
- **A single misbehaving default controller can mask multiple outages.** The Traefik hijack returned 404 for every domain, including `secrets.serendepify.com`, whose containers had also been removed. The port hijack turned distinct problems into one uniform symptom.
- **Approval matters on shared infra.** The host is shared infrastructure; changing k3s configuration requires explicit authorization. The fix was fast, but it should always be communicated before applying.

---

## Further reading

- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — full system architecture
- [`docs/PENDINGS.md`](./PENDINGS.md) — known sharp edges, including k3s ingress defaults
- [`src/lib/bootstrap.ts`](../src/lib/bootstrap.ts) — k3s and Caddy bootstrap code
- [`src/lib/deploy/targets/kubernetes.ts`](../src/lib/deploy/targets/kubernetes.ts) — k3s deploy target
- [k3s documentation: Disabling ServiceLB](https://docs.k3s.io/networking#disabling-servicelb)
- [k3s documentation: Disabling Traefik](https://docs.k3s.io/networking#disabling-traefik)
