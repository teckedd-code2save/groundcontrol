import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seeds the default admin user. Idempotent — safe to re-run.
 */
async function seedAdmin() {
  const existing = await prisma.user.findUnique({ where: { username: "admin" } });
  if (existing) {
    console.log("User 'admin' already exists.");
    return;
  }

  const hash = await bcrypt.hash("groundcontrol2024", 12);
  await prisma.user.create({
    data: {
      username: "admin",
      password: hash,
      role: "admin",
    },
  });

  console.log("Created default admin user.");
  console.log("Username: admin");
  console.log("Password: groundcontrol2024");
}

/**
 * Seeds safe, fake demo data so the dashboard looks alive without a real VPS.
 * Opt-in via:  GC_SEED_DEMO=1 npm run db:seed
 * Idempotent — uses upsert / existence checks, safe to re-run.
 * Does NOT register any VpsConfig, so GroundControl never tries to SSH anywhere.
 * See docs/demo-data.md for details.
 */
async function seedDemo() {
  console.log("Seeding demo data (GC_SEED_DEMO set)...");

  // ── Projects (fake apps under /opt) ────────────────────────────────────────
  const projects = [
    {
      slug: "marketing-site",
      name: "Marketing Site",
      domain: "demo-marketing.example.com",
      path: "/opt/marketing-site",
      repoUrl: "https://github.com/acme/marketing-site",
      category: "app",
      status: "running",
    },
    {
      slug: "api-gateway",
      name: "API Gateway",
      domain: "demo-api.example.com",
      path: "/opt/api-gateway",
      repoUrl: "https://github.com/acme/api-gateway",
      category: "docker",
      status: "running",
    },
    {
      slug: "docs-portal",
      name: "Docs Portal",
      domain: "demo-docs.example.com",
      path: "/var/www/docs-portal",
      category: "static",
      status: "running",
    },
    {
      slug: "analytics-worker",
      name: "Analytics Worker",
      domain: null,
      path: "/opt/analytics-worker",
      repoUrl: "https://github.com/acme/analytics-worker",
      category: "docker",
      status: "stopped",
    },
  ];
  for (const p of projects) {
    await prisma.project.upsert({
      where: { slug: p.slug },
      update: {},
      create: { ...p, lastDeploy: new Date(Date.now() - 1000 * 60 * 60 * 6) },
    });
  }

  // ── Site → container mappings ──────────────────────────────────────────────
  const maps = [
    { siteDomain: "demo-marketing.example.com", containerName: "marketing-site-web-1" },
    { siteDomain: "demo-api.example.com", containerName: "api-gateway-app-1" },
    { siteDomain: "demo-docs.example.com", containerName: "docs-portal-nginx-1" },
  ];
  for (const m of maps) {
    await prisma.siteContainerMap.upsert({
      where: { siteDomain_containerName: { siteDomain: m.siteDomain, containerName: m.containerName } },
      update: {},
      create: m,
    });
  }

  // ── Alerts across severities (only if none exist, to stay idempotent) ──────
  const alertCount = await prisma.alert.count();
  if (alertCount === 0) {
    await prisma.alert.createMany({
      data: [
        { title: "Disk usage high", message: "Root filesystem at 84% on demo host.", severity: "warning", source: "metrics", read: false },
        { title: "Container unhealthy", message: "analytics-worker-1 reported unhealthy and was restarted.", severity: "error", source: "docker", read: false },
        { title: "Memory pressure", message: "Memory usage exceeded 90% for 5 minutes.", severity: "critical", source: "metrics", read: false },
        { title: "Deploy succeeded", message: "api-gateway deployed successfully (commit 1a2b3c4).", severity: "info", source: "deploy", read: true },
        { title: "New login", message: "admin signed in from a new IP.", severity: "info", source: "system", read: true },
      ],
    });
    console.log("Seeded 5 demo alerts.");
  } else {
    console.log(`Alerts already present (${alertCount}); skipping alert seed.`);
  }

  // ── Deployment log history ─────────────────────────────────────────────────
  const deployCount = await prisma.deploymentLog.count();
  if (deployCount === 0) {
    await prisma.deploymentLog.createMany({
      data: [
        { projectSlug: "api-gateway", status: "success", commitSha: "1a2b3c4", branch: "main", durationMs: 42000 },
        { projectSlug: "marketing-site", status: "success", commitSha: "9f8e7d6", branch: "main", durationMs: 31000 },
        { projectSlug: "analytics-worker", status: "failed", commitSha: "deadbee", branch: "main", durationMs: 12000, error: "build step exited with code 1" },
      ],
    });
    console.log("Seeded demo deployment logs.");
  } else {
    console.log(`Deployment logs already present (${deployCount}); skipping.`);
  }

  // ── Metric history (last 24 samples, ~hourly) for the dashboard charts ─────
  const metricCount = await prisma.metricSnapshot.count();
  if (metricCount === 0) {
    const now = Date.now();
    const samples = Array.from({ length: 24 }).map((_, i) => {
      const memTotal = 7964;
      const memPercent = 55 + Math.round(Math.sin(i / 3) * 15) + (i % 4);
      const memUsed = +(memTotal * (memPercent / 100)).toFixed(0);
      const diskTotal = 80;
      const diskPercent = 60 + Math.round(i / 6);
      const diskUsed = +(diskTotal * (diskPercent / 100)).toFixed(1);
      return {
        cpuLoad1: +(0.4 + Math.abs(Math.sin(i / 2)) * 1.6).toFixed(2),
        cpuLoad5: +(0.5 + Math.abs(Math.sin(i / 3)) * 1.2).toFixed(2),
        cpuLoad15: +(0.6 + Math.abs(Math.sin(i / 4)) * 0.9).toFixed(2),
        memUsed,
        memTotal,
        memPercent,
        diskUsed,
        diskTotal,
        diskPercent,
        containerCount: 6,
        runningContainers: i % 7 === 0 ? 4 : 5,
        unhealthyContainers: i % 7 === 0 ? 1 : 0,
        createdAt: new Date(now - (23 - i) * 60 * 60 * 1000),
      };
    });
    await prisma.metricSnapshot.createMany({ data: samples });
    console.log("Seeded 24 demo metric snapshots.");
  } else {
    console.log(`Metric snapshots already present (${metricCount}); skipping.`);
  }

  console.log("Demo data seed complete.");
}

async function main() {
  await seedAdmin();
  if (process.env.GC_SEED_DEMO) {
    await seedDemo();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
