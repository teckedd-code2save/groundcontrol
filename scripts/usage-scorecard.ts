import { prisma } from "../src/lib/prisma";

function argDays() {
  const raw = process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1]
    ?? process.argv[process.argv.indexOf("--days") + 1];
  const days = Number(raw || 30);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function ratio(a: number, b: number) {
  return b ? Number((a / b).toFixed(4)) : null;
}

async function main() {
  const days = argDays();
  const since = new Date(Date.now() - days * 86400000);

  const [hosts, workloads, activeGrants, operations, releases] = await Promise.all([
    prisma.vpsConfig.count(),
    prisma.enrolledDeployment.count(),
    prisma.oAuthGrant.count({ where: { revokedAt: null } }),
    prisma.agentOperation.findMany({
      where: { createdAt: { gte: since } },
      select: {
        status: true,
        attempts: true,
        evidenceJson: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    prisma.deployment.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, durationMs: true },
    }),
  ]);

  const opStatus = Object.fromEntries(
    [...new Set(operations.map((op) => op.status))].sort().map((status) => [
      status,
      operations.filter((op) => op.status === status).length,
    ]),
  );
  const terminal = operations.filter((op) => ["success", "failed", "uncertain"].includes(op.status));
  const successes = operations.filter((op) => op.status === "success");
  const uncertain = operations.filter((op) => op.status === "uncertain");
  const opDurations = operations
    .filter((op) => op.startedAt && op.finishedAt)
    .map((op) => op.finishedAt!.getTime() - op.startedAt!.getTime());

  const releaseStatus = Object.fromEntries(
    [...new Set(releases.map((release) => release.status))].sort().map((status) => [
      status,
      releases.filter((release) => release.status === status).length,
    ]),
  );
  const releaseDurations = releases.map((release) => release.durationMs).filter((v): v is number => v != null);

  const scorecard = {
    generatedAt: new Date().toISOString(),
    window: { days, since: since.toISOString() },
    footprint: {
      savedHosts: hosts,
      enrolledWorkloads: workloads,
      activeAgentGrants: activeGrants,
    },
    agentOperations: {
      total: operations.length,
      byStatus: opStatus,
      terminalOutcomes: terminal.length,
      successful: successes.length,
      uncertain: uncertain.length,
      successRate: ratio(successes.length, terminal.length),
      uncertainRate: ratio(uncertain.length, terminal.length),
      successWithEvidence: successes.filter((op) => Boolean(op.evidenceJson)).length,
      retriedOperations: operations.filter((op) => op.attempts > 1).length,
      durationMs: {
        median: percentile(opDurations, 0.5),
        p95: percentile(opDurations, 0.95),
      },
    },
    releases: {
      total: releases.length,
      byStatus: releaseStatus,
      successRate: ratio(releases.filter((r) => r.status === "success").length, releases.length),
      durationMs: {
        median: percentile(releaseDurations, 0.5),
        p95: percentile(releaseDurations, 0.95),
      },
    },
    definitions: {
      agentOperationSuccessRate: "success / (success + failed + uncertain); cancelled/pending/running/verifying excluded",
      uncertain: "mutation outcome could not be safely confirmed and should be inspected before retry",
      successWithEvidence: "successful durable operation with stored verification/evidence payload",
    },
  };

  console.log(JSON.stringify(scorecard, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
