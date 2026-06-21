> **Note to reviewers:** This is a technical design article, not a marketing piece. It describes a real architectural decision in GroundControl and the trade-offs involved.

# Running a Host Control Plane Inside a Container

## The containerized dashboard problem

A common pattern in self-hosted infrastructure tooling is to ship the control plane as a container on the host it manages. The benefits are straightforward: reproducible builds, simple updates, dependency isolation, and a clean deployment story via `docker compose up -d`.

The difficulty appears when the dashboard needs to perform host-level operations. A container with a mounted Docker socket can manage containers effectively, but it cannot by default:

- install or remove host packages with `apt`, `apk`, or `dnf`;
- interact with the host init system (`systemd`, `openrc`, `runit`);
- run binaries that live only on the host, such as `kubectl` when k3s is installed there;
- modify host configuration files in a way that persists outside bind mounts;
- or reliably determine the host's true capabilities from inside the container namespace.

The result is a control plane that can observe the host but cannot act on it without additional runtime concessions.

## Existing approaches and their trade-offs

There are three conventional ways to resolve this, each with meaningful downsides.

**`--pid=host`**  
Running the dashboard container in the host PID namespace allows `nsenter -t 1` to enter the host's namespaces. This works, but it moves correctness from the code into the deployment configuration. If a user omits the flag — for example, by using the default `docker-compose.yml` — the application silently degrades. Every host command then runs inside the container namespace, producing misleading success or confusing failures.

**Local SSH loopback**  
The dashboard can connect to `127.0.0.1:22` using stored credentials. This is robust and well-understood, but it imposes setup friction that is disproportionate for a tool running on the same machine. It also introduces a dependency on the host SSH daemon's configuration and key management.

**Host agent**  
A separate daemon on the host exposes an API for the dashboard. This is architecturally clean but doubles the operational surface area: two artifacts to install, update, and keep compatible. For a single-tenant self-hosted tool, that friction undermines the containerized deployment story.

GroundControl takes a fourth approach that preserves the default `docker-compose.yml` experience while still reaching the host OS.

## The design: a Docker-socket bridge

The critical observation is that mounting `/var/run/docker.sock` into a container already grants it host-root-equivalent capability. The Docker daemon runs as root and can create privileged containers, mount host paths, and enter host namespaces. Rather than treating this as an incidental deployment detail, GroundControl uses it as an intentional execution primitive.

When GroundControl needs to run a command on the host OS, it builds a small local image, `groundcontrol-host-bridge:latest`, and asks the host Docker daemon to run an ephemeral helper container:

```bash
docker run --rm \
  --privileged \
  --pid=host \
  groundcontrol-host-bridge:latest \
  -t 1 -m -u -i -n -p -- \
  sh -c 'the actual command'
```

The helper runs `nsenter` against the host's PID 1, entering its mount, UTS, IPC, network, and PID namespaces. After `nsenter`, the process sees the host filesystem, the host init system, and the host network. The command executes as if it were started directly on the host. The helper container exits and is removed automatically.

This is conceptually similar to the privileged diagnostic containers used by Portainer for host-level console access, and to the node-debug pattern in Kubernetes. The difference is that GroundControl uses it as a transparent execution backend for normal operations rather than an emergency escape hatch.

## Security framing

It is important to be precise about what this does and does not change.

The bridge does not create a new privilege escalation path. Any code that can execute inside the GroundControl container and talk to `/var/run/docker.sock` can already run the same `docker run --privileged --pid=host` command. The socket is root-equivalent by design. The bridge makes that capability explicit, auditable, and narrowly applied.

Specifically:

- The helper container is **ephemeral** and `--rm`.
- The bridge image is built locally from Alpine + `util-linux`; it is not pulled from an external registry.
- GroundControl verifies host access by comparing the command line of PID 1 inside the container with PID 1 as seen through `execOnTarget`. If they match, it surfaces a warning that host commands are not escaping the container namespace.
- Host operations performed by the AI assistant pass through allow-lists and destructive-pattern checks in `src/lib/host-safety.ts`.

If your threat model does not trust the GroundControl container with root on the host, you should not mount the Docker socket into it. There is no way to have container management and host-level control without that trust boundary.

## Capabilities unlocked

The bridge lets a containerized control plane perform host-level work without changing the default runtime flags. In practice this means:

| Operation | Without bridge | With bridge |
|---|---|---|
| Install Caddy on host | Fails inside container namespace | Installs on host |
| `systemctl restart caddy` | No-op or missing binary | Restarts host service |
| Edit host `/etc/caddy/Caddyfile` outside bind mounts | Not possible directly | Modifies host file |
| `kubectl get nodes` against host k3s | `command not found` | Executes against host cluster |
| Terminal `caddy version` | Not found | Returns host binary version |
| Install k3s on host | Runs inside container | Runs on host |
| AI-driven host remediation | Cannot execute on host | Executes on host |

The terminal behaves like a shell on the host because, after namespace transition, it effectively is one.

## Implementation overview

`src/lib/host-exec.ts` provides `execOnTarget`, the single entry point for host-level execution. Its strategy chain is:

1. **Docker host bridge** — used when GroundControl detects it is containerized and the Docker socket is available. This is the default path for the standard compose file.
2. **`nsenter`** — works when `--pid=host` is present.
3. **SSH loopback** — used if host SSH credentials are configured.
4. **Container fallback** — runs the command inside the GroundControl container, with a warning.

`src/lib/docker-host-bridge.ts` handles image creation and command dispatch. `src/lib/host-capabilities.ts` caches host capabilities and verifies that the bridge actually reaches the host OS.

## When this is the right choice

The bridge is appropriate when:

- You want a containerized control plane with host-level reach.
- You accept that the Docker socket is a root-equivalent capability.
- You prefer a single `docker compose up -d` deployment over a separate host agent or SSH loopback.

It is less appropriate when:

- You cannot mount the Docker socket for security reasons.
- You already manage hosts exclusively over SSH and want a uniform remote-execution model.
- You need the control plane to work without any host-side daemon at all, including Docker.

## Conclusion

GroundControl's container bridge is not a container escape. It is a pragmatic use of an existing root-equivalent capability to solve a real deployment problem: a containerized control plane that genuinely manages its host. The trade-off is honesty about what the Docker socket means. The benefit is a self-hosted tool that deploys like any other container and still acts on the OS beneath it.

If you want to see it in action, the project is open source and runnable in minutes.

---

## Further reading

- [`docs/THE-HACK.md`](./docs/THE-HACK.md) — narrative deep-dive into the bridge
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — full system architecture
- [`src/lib/docker-host-bridge.ts`](./src/lib/docker-host-bridge.ts) — implementation
- [`src/lib/host-exec.ts`](./src/lib/host-exec.ts) — execution strategy chain
- [`README.md`](./README.md) — quick start and feature overview
