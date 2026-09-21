const jwt = require("jsonwebtoken");

const POLL_MS = 2000;
const LEASE_MS = 20 * 60 * 1000;

function parseResources(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

function sessionCookie(user, jwtSecret) {
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    jwtSecret,
    { expiresIn: "20m" }
  );
  return `gc_token=${encodeURIComponent(token)}`;
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30 * 60 * 1000) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 1000) }; }
  return { response, body };
}

async function markFailed(prisma, operation, error, evidence) {
  await prisma.agentOperation.update({
    where: { id: operation.id },
    data: {
      status: "failed",
      error: String(error || "Operation failed").slice(0, 4000),
      evidenceJson: evidence ? JSON.stringify(evidence).slice(0, 20000) : operation.evidenceJson,
      finishedAt: new Date(),
      leaseUntil: null,
    },
  });
}

async function markUncertain(prisma, operation, error, evidence) {
  await prisma.agentOperation.update({
    where: { id: operation.id },
    data: {
      status: "uncertain",
      error: String(error || "The mutation outcome could not be confirmed").slice(0, 4000),
      evidenceJson: JSON.stringify({
        ...(evidence || {}),
        recovery: "inspect_before_retry",
      }).slice(0, 20000),
      finishedAt: new Date(),
      leaseUntil: null,
    },
  });
}

async function executeRedeploy({ prisma, operation, baseUrl, jwtSecret }) {
  const current = await prisma.agentOperation.findUnique({
    where: { id: operation.id },
    include: {
      grant: {
        include: {
          user: { select: { id: true, username: true, role: true, forcePasswordChange: true } },
        },
      },
      deployment: {
        include: { legacyProject: true },
      },
    },
  });
  if (!current) return;
  if (current.grant.revokedAt) return markFailed(prisma, current, "Agent grant was revoked before execution");
  if (current.grant.user.forcePasswordChange || current.grant.user.role !== "admin") {
    return markFailed(prisma, current, "The approving GroundControl user no longer has administrator deployment access");
  }
  if (!parseResources(current.grant.resources).includes(current.deploymentId)) {
    return markFailed(prisma, current, "The grant no longer authorizes this deployment");
  }
  if (!["deployment.redeploy", "deployment.source.deploy"].includes(current.type)) {
    return markFailed(prisma, current, `Unsupported operation type: ${current.type}`);
  }

  const input = parseJson(current.inputJson) || {};
  const sourceDeploy = current.type === "deployment.source.deploy";
  const projectSlug = current.deployment.legacyProject?.slug || current.deployment.slug;
  const latestRelease = current.deployment.legacyProjectId
    ? await prisma.deployment.findFirst({
        where: { projectId: current.deployment.legacyProjectId },
        orderBy: { createdAt: "desc" },
        select: { publicUrl: true, previewUrl: true },
      })
    : null;
  const publicUrl = latestRelease?.publicUrl || latestRelease?.previewUrl ||
    (current.deployment.legacyProject?.domain ? `https://${current.deployment.legacyProject.domain}` : undefined);

  const { response, body } = await fetchJson(`${baseUrl}/api/projects/compose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie(current.grant.user, jwtSecret),
      "X-GroundControl-Agent-Operation": current.id,
    },
    body: JSON.stringify({
      projectSlug,
      projectPath: current.deployment.sourcePath || undefined,
      composePath: current.deployment.composePath || undefined,
      publicUrl,
      action: sourceDeploy ? "source-deploy" : "redeploy",
      branch: sourceDeploy && typeof input.branch === "string" ? input.branch : undefined,
    }),
  });

  if (!response.ok || body.success === false || body.error) {
    return markFailed(prisma, current, body.error || `Redeploy request failed with HTTP ${response.status}`, body);
  }

  if (body.detached) {
    await prisma.agentOperation.update({
      where: { id: current.id },
      data: {
        status: "verifying",
        resultJson: JSON.stringify(body).slice(0, 20000),
        evidenceJson: JSON.stringify({
          phase: sourceDeploy ? "source_deploy_started" : "redeploy_started",
          projectSlug,
          branch: sourceDeploy && typeof input.branch === "string" ? input.branch : undefined,
        }).slice(0, 20000),
        leaseUntil: new Date(Date.now() + LEASE_MS),
      },
    });
    return;
  }

  await prisma.agentOperation.update({
    where: { id: current.id },
    data: {
      status: "success",
      resultJson: JSON.stringify(body).slice(0, 20000),
      evidenceJson: JSON.stringify({ phase: "verified", result: body }).slice(0, 20000),
      finishedAt: new Date(),
      leaseUntil: null,
    },
  });
}

async function reconcileDetached({ prisma, operation, baseUrl, jwtSecret }) {
  const current = await prisma.agentOperation.findUnique({
    where: { id: operation.id },
    include: {
      grant: {
        include: {
          user: { select: { id: true, username: true, role: true, forcePasswordChange: true } },
        },
      },
      deployment: { include: { legacyProject: true } },
    },
  });
  if (!current || current.status !== "verifying") return;
  if (current.grant.revokedAt) {
    // Do not terminate a mutation already in flight; keep observing it, but the
    // revoked client will no longer be able to read the result.
  }
  const projectSlug = current.deployment.legacyProject?.slug || current.deployment.slug;
  const { response, body } = await fetchJson(
    `${baseUrl}/api/projects/compose/log?slug=${encodeURIComponent(projectSlug)}`,
    { headers: { Cookie: sessionCookie(current.grant.user, jwtSecret) } }
  );
  if (!response.ok) {
    if (current.leaseUntil && current.leaseUntil <= new Date()) {
      await prisma.agentOperation.update({
        where: { id: current.id },
        data: {
          status: "uncertain",
          error: `Verification could not be reconciled: ${body.error || response.status}`,
          evidenceJson: JSON.stringify(body).slice(0, 20000),
          finishedAt: new Date(),
          leaseUntil: null,
        },
      });
    }
    return;
  }

  if (body.status === "success") {
    await prisma.agentOperation.update({
      where: { id: current.id },
      data: {
        status: "success",
        evidenceJson: JSON.stringify(body).slice(0, 20000),
        finishedAt: new Date(),
        leaseUntil: null,
      },
    });
    return;
  }
  if (body.status === "failed") {
    await markFailed(prisma, current, body.error || "Detached redeploy failed", body);
    return;
  }

  await prisma.agentOperation.update({
    where: { id: current.id },
    data: {
      evidenceJson: JSON.stringify(body).slice(0, 20000),
      leaseUntil: new Date(Date.now() + LEASE_MS),
    },
  });
}

async function claimPending(prisma) {
  const candidate = await prisma.agentOperation.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;
  const claimed = await prisma.agentOperation.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: {
      status: "running",
      startedAt: new Date(),
      leaseUntil: new Date(Date.now() + LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.agentOperation.findUnique({ where: { id: candidate.id } });
}

async function recoverInterrupted(prisma) {
  const interrupted = await prisma.agentOperation.findMany({
    where: { status: "running" },
    select: { id: true, evidenceJson: true },
  });
  for (const operation of interrupted) {
    const evidence = parseJson(operation.evidenceJson) || {};
    await prisma.agentOperation.update({
      where: { id: operation.id },
      data: {
        status: "uncertain",
        error: "GroundControl restarted or lost its worker while this mutation was running. It was not replayed automatically; inspect the deployment before retrying.",
        evidenceJson: JSON.stringify({ ...evidence, recovery: "mutation_outcome_uncertain" }).slice(0, 20000),
        finishedAt: new Date(),
        leaseUntil: null,
      },
    });
  }
}

function startAgentOperationWorker({ prisma, port, jwtSecret }) {
  let stopped = false;
  let timer = null;
  let ticking = false;
  const baseUrl = `http://127.0.0.1:${port}`;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), POLL_MS);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || ticking) return schedule();
    ticking = true;
    try {
      const verifying = await prisma.agentOperation.findMany({
        where: { status: "verifying" },
        orderBy: { updatedAt: "asc" },
        take: 8,
      });
      for (const operation of verifying) {
        await reconcileDetached({ prisma, operation, baseUrl, jwtSecret }).catch((error) => {
          console.error("[agent-worker] reconcile failed", operation.id, error);
        });
      }

      const operation = await claimPending(prisma);
      if (operation) {
        await executeRedeploy({ prisma, operation, baseUrl, jwtSecret }).catch(async (error) => {
          console.error("[agent-worker] operation failed", operation.id, error);
          await markUncertain(
            prisma,
            operation,
            error instanceof Error ? error.message : String(error),
            { phase: "transport_or_worker_failure" }
          ).catch(() => {});
        });
      }
    } catch (error) {
      console.error("[agent-worker] tick failed", error);
    } finally {
      ticking = false;
      schedule();
    }
  };

  void recoverInterrupted(prisma)
    .catch((error) => console.error("[agent-worker] recovery failed", error))
    .finally(() => void tick());

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    while (ticking) await new Promise((resolve) => setTimeout(resolve, 25));
  };
}

module.exports = { startAgentOperationWorker };
