# Security Policy

GroundControl is infrastructure tooling: it authenticates to your servers and runs commands on them. Please read this document before exposing it to any network you don't fully control.

---

## Reporting a vulnerability

If you discover a security issue, **please do not open a public GitHub issue.**

Instead, report it privately:

- Open a [GitHub Security Advisory](https://github.com/teckedd-code2save/groundcontrol/security/advisories/new) (preferred), **or**
- Contact the maintainers privately through the repository's listed contact.

Please include:
- A description of the vulnerability and its impact.
- Steps to reproduce (a proof-of-concept if possible).
- Any suggested remediation.

**Expectations:**
- We aim to acknowledge reports within **72 hours**.
- We'll work with you on a fix and coordinate a disclosure timeline.
- Please give us a reasonable window to patch before public disclosure. We're happy to credit you.

Supported version: the latest `main` / most recent release. Older versions are not patched.

---

## Threat model

GroundControl is a **trusted, privileged control plane**, not a multi-tenant SaaS. Its security posture assumes a single trusted operator running it on hardware they own.

### What GroundControl is trusted to do

- **It runs arbitrary commands on your hosts.** Every feature (Docker control, proxy reloads, the browser terminal, deploys) ultimately executes shell commands either locally or over SSH (`src/lib/vps.ts`). A user with dashboard access is effectively **root on every managed host**.
- **It mounts `/etc` read-write** in the Docker deployment. It can read and modify host system configuration (Caddy, Nginx, and more).
- **It mounts the Docker socket** (`/var/run/docker.sock`), which is equivalent to host root.

There is no privilege separation between "view" and "act" beyond the single admin login. Treat dashboard access as full server access.

### Controls in place

- **Authentication on every API route** — JWT cookie (`gc_token`): httpOnly, `SameSite=Lax`, `Secure` in production, 7-day expiry. Routes call `requireAuth()`, which rejects missing/invalid tokens.
- **Password hashing** — bcrypt at cost factor 12.
- **Login rate-limiting** — 5 attempts per IP per 15-minute window, then HTTP 429.
- **Command quoting** — user-supplied values are passed through `shQuote()` before interpolation into shell commands.
- **Terminal guard** — the browser terminal blocks an obviously-dangerous command list (see `src/app/api/terminal/route.ts`).
- **Destructive-action confirmations** — stop/remove/prune operations require an explicit, consequence-explaining confirmation in the UI.

### Known risks & limitations

- **SSH keys and VPS passwords are stored in the SQLite `VpsConfig` table without encryption at rest.** Anyone with read access to the database file (or the `groundcontrol-db` Docker volume) can extract them. Encryption at rest via a `GROUNDCONTROL_SECRET` key is on the roadmap. **Until then: protect the DB file and the host.**
- **The AI assistant sends prompts to the OpenAI API.** Logs or metrics you paste into the chat leave your network. Leave `OPENAI_API_KEY` unset to disable AI entirely.
- **The terminal blocklist is a guardrail, not a sandbox.** It is not a substitute for trusting the operator.
- **Single-admin model.** There is no per-user RBAC yet; anyone who can log in has full control.
- **The seed creates a well-known default credential** (`admin` / `groundcontrol2024`). Change it on first login.

---

## Hardening checklist

Before running GroundControl anywhere reachable:

- [ ] Set a strong, unique `JWT_SECRET` (`openssl rand -hex 32`); never reuse a default.
- [ ] Change the seeded `admin` password immediately after first login.
- [ ] Run **only** behind an HTTPS reverse proxy (Caddy/Nginx/Traefik). Never expose port 3003/3000 directly.
- [ ] Bind the container to `127.0.0.1` (the default compose config does this) so it's only reachable via the proxy.
- [ ] Prefer **key-based** SSH auth over passwords for managed hosts.
- [ ] Restrict who can reach the dashboard (firewall, VPN, IP allowlist, or proxy-level auth) — defense in depth on top of the login.
- [ ] Protect the SQLite database file / Docker volume; back it up securely, treat it as a secrets store.
- [ ] Keep the host and Docker patched.
- [ ] Review the terminal blocked-command list and tighten it for your environment if needed.
