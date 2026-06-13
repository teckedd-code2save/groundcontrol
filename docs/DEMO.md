# GroundControl — Demo Recording Script

A click-by-click script for recording a 2–4 minute demo that shows GroundControl off well. Optimized for a screen recording you can share online (Twitter/X, LinkedIn, a portfolio page, Loom, YouTube).

---

## Before you record

1. **Seed demo data** so the dashboard looks alive without exposing a real server. See [demo-data.md](./demo-data.md):
   ```bash
   GC_SEED_DEMO=1 npm run db:seed
   npm run dev
   ```
   This adds fake projects, alerts, metric history, and site mappings. It's idempotent and safe to re-run.
2. Open **http://localhost:3000** in a clean browser window (no extensions bar, no personal bookmarks). Use a ~1440px window.
3. On first run, create the admin account via the `/setup` flow, or seed with `GC_SETUP_PASSWORD=your-strong-password GC_SEED_DEMO=1 npm run db:seed`.
4. (Optional) Set `OPENAI_API_KEY` in `.env` so the AI assistant responds live during the demo. If you leave it unset, narrate that AI is optional and skip the AI beat.
5. Decide your narration up front — keep it benefits-first ("one place to see every server"), not feature-first.

---

## The script (in order)

### 0. Cold open — the login (5s)
- Land on the login screen. One line: *"GroundControl is a self-hosted cockpit for your VPS fleet."*
- Log in. The guarded UI loads.

### 1. Dashboard — the "why" (20s)
- Open **Dashboard**.
- Point at the **narrative health overview** — emphasize it translates raw stats into plain English.
- Highlight the **stat cards** (CPU, memory, disk, container counts) and the **metrics chart** (powered by the seeded `MetricSnapshot` history).
- Line: *"At a glance: is everything healthy, and if not, what's wrong."*

### 2. Topology — the hero shot (30s)
- Open **Topology**. Let the graph lay out (React Flow + Dagre).
- Trace the hierarchy out loud: **Internet → VPS Host → Caddy → Sites → Containers.**
- **Click a container node** to inspect it. Show that nodes are interactive, not just a picture.
- Line: *"This is generated from the real state of the box — Docker, the proxy, the filesystem — not a static diagram."*

### 3. Containers — control (25s)
- Open **Containers**.
- Scroll the list; point out status badges (running / stopped / unhealthy).
- Open a container's **logs**.
- Hover **stop/restart** to reveal the **confirmation dialog** — emphasize that destructive actions explain their blast radius.
- Line: *"Full lifecycle control — start, stop, restart, logs — with guardrails."*

### 4. Projects & Proxy — the map (20s)
- Open **Projects**: folder-first view of `/opt`, cross-referenced with sites and stacks.
- Open **Proxy**: show a parsed Caddy/Nginx site mapped to the container that serves it.
- Line: *"It reads your actual Caddyfiles and maps every domain to the container behind it."*

### 5. AI assistant — the wow (30s)
- Open the **AI chat widget**.
- Ask something real and ops-flavored, e.g.:
  - *"Why might a container show as unhealthy?"*
  - *"Explain what high load average but low CPU usage means."*
- Let the **streamed response** render on camera.
- Line: *"An ops assistant that knows it's inside a VPS cockpit — paste a log, ask it to debug a deploy."*

### 6. Terminal — the power move (15s)
- Open **Terminal**.
- Run a harmless command (`docker ps`, `df -h`, or `uptime`) over the live SSH session.
- Line: *"And when you need to drop down, there's a real terminal — with a blocked-command guard."*

### 7. Alerts — the safety net (10s)
- Open **Alerts**. Show a few seeded alerts across severities (info → critical).
- Line: *"Auto-generated alerts for memory pressure, disk, unhealthy containers, and failed deploys."*

### 8. Close (10s)
- Back to **Topology** (the strongest visual) or the **Dashboard**.
- Line: *"Self-hosted, no agents on your hosts, no SaaS in the middle. Open source. Link below."*
- End card: repo URL + `groundcontrol.serendepify.com`.

---

## Recording tips

- **Resolution:** record at 1080p+ and keep the browser window fixed across the whole take.
- **Pace:** move deliberately; pause ~1s after each click so viewers can track what changed.
- **Cursor:** enable cursor highlighting if your recorder supports it.
- **Mute the box:** make sure no real hostnames, IPs, domains, or keys are visible. Blur in post if needed.
- **Hero GIF:** export a 6–10s loop of the topology graph laying out, or a container action + confirmation, for social posts.
- **Length:** aim for under 3 minutes for social; a 5–7 minute "deep dive" cut is great for the portfolio page.

## Suggested captions / hooks

- "I built a self-hosted control plane for my servers — here's the 2-minute tour. 🛰️"
- "One dashboard for every container, proxy, and deploy across my VPS fleet — with an AI ops assistant built in."
- "No agents. No SaaS. Just SSH, Next.js, and SQLite. Open source 👇"
