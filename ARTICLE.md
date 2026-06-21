# The Container That Learned to Drive the Host

*How GroundControl turned a Docker container into a real VPS cockpit — without `--pid=host`, without a host agent, and without asking permission.*

---

## The bait and switch of containerized dashboards

Every self-hosting project eventually faces the same architectural question: **where do you put the dashboard?**

If you build a tool to manage VPSes, the natural place to run it is *inside a container on the VPS it manages*. Containers are reproducible. They update cleanly. They keep dependencies tidy. So you write a Next.js app, wrap it in Docker, mount `/var/run/docker.sock`, and call it a day.

And then reality arrives.

Your dashboard can list containers. It can tail logs. It can restart services — if those services are also containers. But the moment you try to do something that matters on the host OS, you hit a wall:

- `apt install caddy` installs Caddy *inside the container*, not on the host.
- `systemctl restart caddy` fails because systemd is not running inside the container.
- `kubectl get nodes` returns `command not found` even though k3s is humming along on the host.
- `caddy version` in the terminal reports `not found` because the binary is on the host filesystem, not in the container's PATH.

The container is a jail with a nice view of the prison yard.

This is exactly where GroundControl started: a containerized app that could *see* a VPS but could not *drive* it.

---

## The usual exits, and why they feel like surrender

There are three standard ways out of this jail. None of them fit the product I wanted to build.

**Option 1: `--pid=host`**

Run the container in the host's PID namespace. Now `nsenter -t 1` enters the host's namespaces, and host commands work. This is simple and correct.

It is also easy to forget. Your `docker-compose.yml` does not include it by default. The first user who follows your README and runs `docker compose up -d` will get a dashboard that *looks* like it works but silently runs every host command inside the container. Worse, `--pid=host` is a runtime flag, not a code decision. The product's correctness depends on the user reading a footnote.

**Option 2: SSH to the local host**

Make the dashboard connect to `localhost:22` over SSH, using credentials stored in its own database. This works. It is also ridiculous: you are asking users to set up SSH key auth from a container to the same machine it is running on, just so it can act like a local admin.

**Option 3: Install a host agent**

Run a small daemon on the host that the dashboard talks to over HTTP or a Unix socket. This is the cleanest architecture. It is also the most friction: now you have two things to install, two things to update, and two things that can drift out of sync.

I did not want GroundControl to be any of these. I wanted it to work the way people expect modern self-hosted tools to work: `docker compose up -d`, open the browser, done.

---

## The key under the mat

Here is the thing about mounting `/var/run/docker.sock` into a container: **you have already given the container root on the host.**

The Docker daemon runs as root. Anyone who can talk to its socket can create, start, stop, and delete containers. They can mount the host root filesystem. They can run a container with `--privileged --pid=host`. The socket is not a "view" of Docker; it is a root-equivalent capability wearing a friendly API.

So the question stopped being "how do we escape the container?" and started being "why aren't we using the door that is already open?"

GroundControl's answer is a tiny local image called `groundcontrol-host-bridge`. When the app needs to run something on the host OS, it asks the Docker daemon to create an ephemeral helper container:

```bash
docker run --rm \
  --privileged \
  --pid=host \
  groundcontrol-host-bridge:latest \
  -t 1 -m -u -i -n -p -- \
  sh -c 'the actual command'
```

The helper runs `nsenter` against PID 1 of the host, entering the host's mount, UTS, IPC, network, and PID namespaces. At that point the process is no longer inside the GroundControl container. It is on the host.

`/bin/sh` resolves to the host's shell. `systemctl` talks to the host's systemd. `apk` or `apt` modify the host's package database. `kubectl` uses the host's kubeconfig and talks to the host's k3s. The command runs, the helper exits, the container is removed.

GroundControl itself never needs `--pid=host`. It never needs `--privileged`. It just needs the Docker socket, which it already had.

---

## Why this is not a container escape vulnerability

The knee-jerk reaction is that this is a container escape. It is not. It is a **container escape only in the same sense that mounting `/var/run/docker.sock` is a container escape** — which is to say, the dangerous decision was made the moment the socket was mounted.

If an attacker can execute code inside the GroundControl container and talk to the Docker socket, they already own the host. They could run the exact same `docker run --privileged --pid=host` command themselves. The bridge does not create a new privilege; it uses an existing one to do something useful.

What the bridge *does* do is make that capability explicit, auditable, and constrained:

- The helper container is **ephemeral**: one per command, auto-removed.
- The bridge image is **built locally** from Alpine + `util-linux`, not pulled from a registry.
- GroundControl **verifies** host access by comparing the host's PID 1 command line to its own. If they match, it warns that host commands are still running inside the container namespace.
- The terminal and AI tools use **allow-lists and destructive-pattern blocks** so arbitrary host damage is harder.

The security model is honest: the Docker socket is root, and GroundControl treats it that way.

---

## The moment it clicked

After wiring the terminal to route every command through the bridge, I typed:

```
caddy version
```

Into a browser terminal. A web app running inside Docker. On a VPS. With no `--pid=host`.

And it answered with the host's Caddy version.

That single output is the whole product. A containerized dashboard typing commands into the host OS as if it were native. No SSH setup. No host agent. No special compose flags. Just the Docker socket and a little namespace gymnastics.

That is when GroundControl stopped being a dashboard and became a cockpit.

---

## What this unlocks in practice

The bridge changes what the product can promise. Here is the before and after:

| Task | Before bridge | After bridge |
|---|---|---|
| Install Caddy | Fails with `apk` errors | Installs on host |
| `systemctl restart caddy` | Runs in container void | Restarts host service |
| Edit `/etc/caddy/Caddyfile` | Edits bind-mounted copy | Edits host file |
| `kubectl get nodes` | `kubectl: not found` | Talks to host k3s |
| Terminal `caddy version` | Not found | Returns host version |
| Install k3s | Runs inside container | Runs on host |
| AI: "restart nginx" | Impossible | Executes on host |

The terminal feels like a real VPS shell because it is one. The install buttons work because they target the real OS. The AI assistant can reason about the actual host because its tools execute there.

---

## The bigger idea

GroundControl is a bet that the future of self-hosted infrastructure tools looks less like a SaaS dashboard and more like a **local-first control plane**.

You own the database (SQLite). You own the credentials (encrypted at rest). You own the execution context (your VPS, not someone else's cloud). The AI assistant has memory in your database, not in OpenAI's logs. The terminal executes on your host, not in a remote shell rented by the month.

The container bridge is the technical trick that makes this possible, but the philosophy is what matters: **a tool that runs on your infrastructure should actually run on your infrastructure**, not gesture at it from across a network boundary.

---

## Try it

GroundControl is open source. You can run it locally in minutes:

```bash
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
npm run dev
```

Or deploy it on a VPS in five minutes with Docker Compose:

```bash
ssh your-vps
cd /opt
git clone https://github.com/teckedd-code2save/groundcontrol.git .
printf 'JWT_SECRET="%s"\n' "$(openssl rand -hex 32)" > .env
docker compose up -d
```

No `--pid=host`. No host agent. No SaaS. Just a container that learned to drive the host.

---

## Read more

- [`docs/THE-HACK.md`](./docs/THE-HACK.md) — the deep-dive version of this story
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — full technical architecture
- [`src/lib/docker-host-bridge.ts`](./src/lib/docker-host-bridge.ts) — the bridge implementation
- [`README.md`](./README.md) — quick start and feature overview
