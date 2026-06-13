# Demo Data

GroundControl can seed safe, fake data so the dashboard looks alive in a demo or screen recording **without connecting to a real VPS**. This is ideal for screenshots, the [demo script](./DEMO.md), and exploring the UI before you have a server to point it at.

## How to seed

The demo data is **opt-in** via the `GC_SEED_DEMO` environment variable:

```bash
# Seed demo data and create an admin via the setup flow:
GC_SEED_DEMO=1 npm run db:seed
npm run dev
# Then visit http://localhost:3000/setup and create the first admin.

# Or create the admin non-interactively with a strong setup password:
GC_SETUP_PASSWORD=your-strong-password GC_SEED_DEMO=1 npm run db:seed
npm run dev
# Log in as admin with the GC_SETUP_PASSWORD; you will be forced to change it.
```

The seed is **idempotent** — re-running it won't create duplicates. Projects and site mappings are upserted; alerts, deployment logs, and metric snapshots are only inserted when their tables are empty.

## What gets seeded

All values are fictional and use `example.com` domains. Crucially, **no `VpsConfig` row is created**, so GroundControl never attempts to SSH or exec against any host during a demo.

| Model | Rows | Contents |
|-------|------|----------|
| `User` | 1 | Created via `/setup` or `GC_SETUP_PASSWORD`; demo data does not include a hardcoded password |
| `Project` | 4 | Fake apps under `/opt` and `/var/www`: a marketing site (running), API gateway (running), docs portal (static, running), analytics worker (stopped) |
| `SiteContainerMap` | 3 | Maps demo domains to fake container names so the proxy/topology views show relationships |
| `Alert` | 5 | One per severity flavor: disk warning, unhealthy-container error, memory-pressure critical, deploy-success info, login info |
| `DeploymentLog` | 3 | A mix of successful and one failed deploy, with commit shas and durations |
| `MetricSnapshot` | 24 | ~Hourly samples over the last 24h (CPU load, memory, disk, container health) so the dashboard charts have a realistic curve |

## Notes & safety

- **No real infrastructure is touched.** The absence of a `VpsConfig` means live data-fetching views (containers list, terminal, real stats) will simply show "No VPS configured" — the *seeded* views (dashboard charts, alerts, projects, deploy history) are what make the demo look populated.
- **Schema is untouched.** Demo data only uses existing models/fields; it requires no migration.
- **To reset**, delete your dev database and re-run migrations + seed:
  ```bash
  rm -f prisma/dev.db
  npx prisma migrate dev
  GC_SEED_DEMO=1 npm run db:seed
  ```
- For a fully live demo (real containers in the topology, working terminal, live metrics), connect a throwaway VPS you control in **Settings → VPS Connection** instead of — or in addition to — seeding demo data.
