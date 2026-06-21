# The Hack: How GroundControl Escaped Its Own Container

> *"A container is a jail with a door. We found the key under the mat."*

---

## The problem we created for ourselves

GroundControl was born to manage a VPS. The obvious way to ship it was inside a Docker container on that same VPS. Clean, reproducible, easy to update.

But then reality hit.

The GC container could see Docker containers through the mounted socket, but it could not:

- install a package with `apk` or `apt` on the host
- run `systemctl restart caddy`
- edit `/etc/caddy/Caddyfile` and have it matter
- call `kubectl` against the host's k3s cluster
- or even tell whether `caddy` was installed

Every host-level command ran inside the GC container's filesystem and PID namespace. The terminal showed `caddy: not found`. The install buttons failed with cryptic `apk` errors. The dashboard lied about what was on the box.

The textbook answers were:

1. **Run GC with `--pid=host`** — easy, but brittle and not the default in any sane `docker-compose.yml`.
2. **Manage the VPS over SSH** — correct, but forces the user to set up SSH keys even on the local box.
3. **Install a host agent** — clean, but now you have two moving parts.

None of them felt like GroundControl. We wanted GC to work *out of the box* when you ran `docker compose up -d`, the same way Portainer or Yacht work.

---

## The insight

GC already had the Docker socket mounted. That socket is root on the host in disguise. If you can create containers, you can create a container that **is** the host.

So we built a tiny local image called `groundcontrol-host-bridge:latest`.

When GC needs to run something on the host OS, it asks the host Docker daemon to spawn an ephemeral helper container:

```bash
docker run --rm \
  --privileged \
  --pid=host \
  groundcontrol-host-bridge:latest \
  -t 1 -m -u -i -n -p -- \
  sh -c 'the actual command'
```

The helper runs `nsenter` against PID 1 of the host, entering the host's **mount, UTS, IPC, network, and PID** namespaces. At that point the process is effectively running on the host OS:

- `/` is the host root filesystem
- PID 1 is the host init (`systemd`, `openrc-init`, etc.)
- `systemctl` talks to the host's service manager
- `apk`/`apt` install packages on the host
- `kubectl` talks to the host's k3s
- `/opt`, `/etc`, `/var/www` are the host's real directories

GC itself stays unprivileged and un-special. It just knows how to ask Docker for a one-shot root shell.

---

## Why this is not a security horror show

Yes, the helper is `--privileged`. But the only way to get there is through a Docker socket that is **already** root-equivalent. If an attacker has code execution inside the GC container and can talk to `/var/run/docker.sock`, they already own the host. The bridge does not introduce a new privilege boundary; it uses an existing one to do something useful.

The bridge is also:

- **ephemeral** — one container per command, auto-removed
- **imageless by default** — built lazily from Alpine + `util-linux`
- **only used when GC detects it is containerized** — bare-metal or `--pid=host` deployments fall back to normal `nsenter`
- **verify-able** — GC compares the host's PID 1 command line to its own; if they match, it warns that host access is not working

---

## What it unlocks

The bridge turns a containerized dashboard into a real VPS cockpit:

| Feature | Without bridge | With bridge |
|---|---|---|
| Install Caddy | fails with `apk` errors | installs on host |
| `systemctl restart caddy` | runs in container void | restarts host service |
| Edit `/etc/caddy/Caddyfile` | edits bind-mounted copy | edits host file |
| `kubectl get nodes` | `kubectl: not found` | talks to host k3s |
| Terminal `caddy version` | not found | returns host version |
| Install k3s | runs inside container | runs on host |

This is why the terminal suddenly starts feeling like a real VPS shell: because it is.

---

## How it fits the architecture

`execOnTarget` is the single entry point for "run this on the machine the user cares about."

```
execOnTarget(command, vps?, cwd?)
    │
    ├─► SSH mode? ─────────────────────► execOnVps over SSH
    │
    ├─► Local bare metal? ─────────────► execOnVps locally
    │
    └─► Containerized local mode?
         │
         ├─► Strategy 0: Docker host bridge (spawn privileged helper via socket)
         ├─► Strategy 1: nsenter (works if --pid=host was given)
         ├─► Strategy 2: SSH loopback to host gateway
         └─► Strategy 3: fall back to container execution (with warning)
```

The bridge is Strategy 0 because it is the only one that works with the default `docker-compose.yml`.

---

## The moment it clicked

After wiring the terminal to use `execOnTarget`, a user typed:

```
caddy version
```

and got back the host's Caddy version instead of `not found`.

That single line is the whole product. A web app running inside Docker, typing commands into a browser, executing them on the host OS as if it were native. No SSH key setup. No `--pid=host`. No host agent. Just the Docker socket and a little bit of namespace gymnastics.

That is the hack.

---

## See also

- [`src/lib/docker-host-bridge.ts`](../src/lib/docker-host-bridge.ts) — the bridge implementation
- [`src/lib/host-exec.ts`](../src/lib/host-exec.ts) — strategy chain and fallbacks
- [`src/lib/host-capabilities.ts`](../src/lib/host-capabilities.ts) — host-access verification
