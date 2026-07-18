import { NextRequest, NextResponse } from "next/server";
import { decryptMaybe } from "@/lib/crypto";
import { verifyGithubWebhookSignature } from "@/lib/github-app";
import { syncGithubInstallation, upsertGithubInstallation } from "@/lib/github-app-service";
import { getLoopEngine, ingestEvents, setLoopEngine, type OperationalEvent } from "@/lib/intelligence";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type WebhookPayload = {
  action?: string;
  after?: string;
  ref?: string;
  installation?: {
    id: number;
    repository_selection?: string;
    suspended_at?: string | null;
    account?: { login?: string; type?: string };
  };
  repository?: { full_name?: string; html_url?: string };
  workflow_run?: { id?: number; name?: string; status?: string; conclusion?: string | null; head_sha?: string };
  deployment?: { id?: number; sha?: string; ref?: string; environment?: string };
  deployment_status?: { id?: number; state?: string; environment?: string };
  pull_request?: { number?: number; head?: { sha?: string }; merged?: boolean };
};

function safeSummary(event: string, payload: WebhookPayload) {
  return {
    ref: payload.ref || "",
    after: payload.after || "",
    workflow: payload.workflow_run ? {
      id: payload.workflow_run.id,
      name: payload.workflow_run.name,
      status: payload.workflow_run.status,
      conclusion: payload.workflow_run.conclusion,
      headSha: payload.workflow_run.head_sha,
    } : undefined,
    deployment: payload.deployment ? {
      id: payload.deployment.id,
      sha: payload.deployment.sha,
      ref: payload.deployment.ref,
      environment: payload.deployment.environment,
    } : undefined,
    deploymentStatus: payload.deployment_status ? {
      id: payload.deployment_status.id,
      state: payload.deployment_status.state,
      environment: payload.deployment_status.environment,
    } : undefined,
    pullRequest: payload.pull_request ? {
      number: payload.pull_request.number,
      headSha: payload.pull_request.head?.sha,
      merged: payload.pull_request.merged,
    } : undefined,
    event,
  };
}

async function recordLoopChange(deliveryId: string, event: string, payload: WebhookPayload) {
  const fullName = payload.repository?.full_name || "";
  if (!fullName || !["push", "workflow_run", "deployment", "deployment_status", "pull_request"].includes(event)) return;
  const repository = await prisma.githubRepository.findUnique({
    where: { fullName },
    include: { deployments: { include: { deployment: true } } },
  });
  const serviceIds = repository?.deployments.map((link) => link.deployment.slug) || [];
  const host = await prisma.vpsConfig.findFirst({ where: { isActive: true }, select: { id: true } });
  const change: OperationalEvent = {
    id: `github_${deliveryId}`,
    hostId: host ? `vps-${host.id}` : "github",
    serviceIds,
    kind: "artifact_changed",
    observedAt: new Date().toISOString(),
    source: "github",
    beforeRef: undefined,
    afterRef: payload.after || payload.workflow_run?.head_sha || payload.deployment?.sha || payload.pull_request?.head?.sha,
    evidenceArtifactIds: [deliveryId],
    meta: { event, repository: fullName, action: payload.action || "" },
  };
  setLoopEngine(ingestEvents(getLoopEngine(), [change]));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const deliveryId = req.headers.get("x-github-delivery") || "";
  const event = req.headers.get("x-github-event") || "unknown";
  const signature = req.headers.get("x-hub-signature-256");
  if (!deliveryId) return NextResponse.json({ error: "Missing delivery ID" }, { status: 400 });

  const connection = await prisma.githubAppConnection.findFirst();
  const secret = connection ? decryptMaybe(connection.webhookSecretEncrypted) : "";
  if (!connection || !secret || !verifyGithubWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  const duplicate = await prisma.githubWebhookDelivery.findUnique({ where: { id: deliveryId } });
  if (duplicate?.status === "processed" || duplicate?.status === "ignored") {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 202 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const installationId = payload.installation?.id ? String(payload.installation.id) : "";
  const repositoryFullName = payload.repository?.full_name || "";
  await prisma.githubWebhookDelivery.upsert({
    where: { id: deliveryId },
    create: {
      id: deliveryId,
      event,
      action: payload.action || "",
      repositoryFullName,
      installationId,
      summaryJson: JSON.stringify(safeSummary(event, payload)),
    },
    update: {
      status: "received",
      error: null,
      action: payload.action || "",
      repositoryFullName,
      installationId,
      summaryJson: JSON.stringify(safeSummary(event, payload)),
    },
  });

  try {
    if (event === "installation" && payload.installation) {
      if (payload.action === "deleted") {
        await prisma.githubInstallation.deleteMany({ where: { id: installationId } });
      } else {
        await upsertGithubInstallation(connection.id, payload.installation);
        if (["created", "unsuspend", "new_permissions_accepted"].includes(payload.action || "")) {
          await syncGithubInstallation(installationId);
        }
      }
    } else if (event === "installation_repositories" && payload.installation) {
      await upsertGithubInstallation(connection.id, payload.installation);
      await syncGithubInstallation(installationId);
    }
    await recordLoopChange(deliveryId, event, payload);
    await prisma.githubWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "processed", processedAt: new Date() },
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error("[github-webhook]", error);
    await prisma.githubWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed", processedAt: new Date() },
    });
    return NextResponse.json({ error: "Webhook accepted but processing failed" }, { status: 500 });
  }
}
