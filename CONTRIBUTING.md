# Contributing to GroundControl

Thanks for your interest in improving GroundControl! This guide covers local setup, the project layout, conventions, and how to add new pages and API routes.

---

## Dev setup

**Prerequisites:** Node.js 20+, npm, and (optionally) Docker for testing the container build.

```bash
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol
npm install

cp .env.example .env          # then set JWT_SECRET (openssl rand -hex 32)

npx prisma migrate dev        # create the SQLite DB, apply migrations, generate client
npm run db:seed               # seed default admin (admin / groundcontrol2024)

npm run dev                   # http://localhost:3000
```

You do **not** need a real VPS to develop the UI. Register a host you control in **Settings → VPS Connection**, or seed demo data (see [docs/demo-data.md](./docs/demo-data.md)) so the dashboard looks alive without connecting anywhere.

> ⚠️ This repo pins **Next.js 16** (App Router, React 19), which has breaking changes vs. older majors. When in doubt about conventions, follow the existing code and `package.json` scripts rather than older Next.js habits.

---

## Project structure

```
groundcontrol/
├── prisma/
│   ├── schema.prisma          # Data model (SQLite). DO NOT edit casually — it drives migrations.
│   ├── migrations/            # Generated migration history. Never hand-edit applied migrations.
│   └── seed.ts                # Idempotent seed (default admin user). Wired to `npm run db:seed`.
│
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── <page>/page.tsx    # UI routes: dashboard, topology, containers, projects,
│   │   │                      #   proxy, processes, files, terminal, alerts, settings, login, deploy
│   │   ├── api/<name>/route.ts# API route handlers (REST-ish). One folder per resource.
│   │   ├── layout.tsx         # Root layout
│   │   └── globals.css        # Tailwind v4 entrypoint
│   │
│   ├── lib/                   # Server-side core logic (no React)
│   │   ├── vps.ts             # ★ Remote-exec layer: SSH/local command execution, docker/caddy/
│   │   │                      #   compose helpers, system stats. The heart of the app.
│   │   ├── auth.ts            # JWT verification helpers (getUserFromToken, requireAuth)
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── topology.ts        # Builds the topology graph model
│   │   ├── alerts.ts          # Alert generation logic
│   │   └── ai-config.ts       # AI key resolution (env var > ai-config.json)
│   │
│   └── components/            # React components (sidebar, topology nodes, AI chat widget,
│                              #   stat cards, confirm dialogs, etc.)
│
├── docs/                      # Project documentation, demo scripts, screenshots
├── docker-compose.yml         # Production container + host volume mounts
├── Dockerfile                 # Multi-stage build
└── .github/                   # CI/CD (build → GHCR → deploy over SSH)
```

---

## How to run things

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Serve production build | `npm run start` |
| Lint | `npm run lint` |
| Seed default admin | `npm run db:seed` |
| New migration after schema edit | `npx prisma migrate dev --name <change>` |
| Regenerate Prisma client | `npx prisma generate` |
| Inspect the DB | `npx prisma studio` |

---

## Code conventions

- **TypeScript everywhere.** Prefer explicit types on exported functions and API payloads.
- **Server logic lives in `src/lib/`**, not in components or route files. Route handlers should be thin: auth → parse → call a `lib` function → respond.
- **All remote/host operations go through `src/lib/vps.ts`.** Don't shell out directly from a route. Use `execOnVps`, `runDockerCompose`, `resolveBinary`, etc. Always pass user input through `shQuote()` before interpolating into a command.
- **Every API route must authenticate.** Call `requireAuth(req)` (from `src/lib/auth.ts`) at the top of each handler; it throws on a missing/invalid token.
- **Destructive UI actions require confirmation.** Reuse `ConfirmDelete` / `ActionConfirm` components, and write a message that explains the consequence.
- **No hardcoded secrets.** Read configuration from `process.env`. See [`.env.example`](./.env.example) for the full list.
- **Styling is Tailwind v4** utility classes. Keep components in `src/components/` reusable.

---

## Adding a new page (UI route)

1. Create `src/app/<name>/page.tsx`. With the App Router, the folder name *is* the route (`/name`).
2. Wrap protected content with the auth guard (`src/components/AuthGuard.tsx`) and add a link in `src/components/Sidebar.tsx`.
3. Fetch data from your API route(s) — **never hardcode data in the component**.

## Adding a new API route

1. Create `src/app/api/<name>/route.ts`.
2. Export the HTTP method handlers you need:

   ```ts
   import { NextRequest, NextResponse } from "next/server";
   import { requireAuth } from "@/lib/auth";
   import { execOnVps } from "@/lib/vps";

   export async function GET(req: NextRequest) {
     try {
       await requireAuth(req);              // 1. auth
       const result = await execOnVps("…"); // 2. do work via lib helpers
       return NextResponse.json(result);    // 3. respond
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }
   ```

3. If you read a **new env var**, add it to [`.env.example`](./.env.example) with a comment in the same PR.

## Changing the data model

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name <descriptive_change>` to generate and apply a migration.
3. Commit the new folder under `prisma/migrations/`. **Never** hand-edit a migration that has already been applied/committed.

---

## Adapting hardcoded host paths

Some paths are still baked into source. If you're running on a server with a different layout, these are the files to change:

| What | Where |
|------|-------|
| Project root (`/opt`) | `src/lib/vps.ts`, `src/app/api/deploy/route.ts`, deploy/projects UI |
| Caddy sites dir (`/etc/caddy/sites`) | `src/lib/vps.ts`, `src/app/api/proxy/route.ts` |
| Main Caddyfile (`/etc/caddy/Caddyfile`) | `src/app/api/proxy/route.ts` |
| Nginx paths | `src/app/api/proxy/route.ts` |
| SSL cert domain check | `src/app/api/health-score/route.ts` |
| Volume mounts | `docker-compose.yml` |

Making these runtime-configurable (rather than hardcoded) is on the [roadmap](./README.md#-roadmap) — PRs very welcome.

---

## Pull requests

- Keep PRs focused and describe the "why," not just the "what."
- Run `npm run lint` and `npm run build` before pushing.
- If you touch the schema, include the generated migration.
- If you add an env var, update `.env.example`.

By contributing, you agree your contributions are licensed under the project's [MIT License](./LICENSE).
