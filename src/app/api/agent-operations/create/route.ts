import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HttpError, handleApiError } from "@/lib/errors";
import { parseResourceIds } from "@/lib/oauth";
import { assertCreationGrant, inspectCreationSpec, normalizeCreationSpec } from "@/lib/agent-creation";
import { launchTemplateDeployment } from "@/lib/template-launch";

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const id = req.headers.get("X-GroundControl-Agent-Operation");
    if (!id) throw new HttpError("A durable creation operation is required.", 403);
    const operation = await prisma.agentOperation.findUnique({ where: { id }, include: { grant: { include: { user: true } }, deployment: { include: { vpsConfig: true, legacyProject: true } } } });
    if (!operation || operation.type !== "deployment.create" || operation.grant.userId !== user.id) throw new HttpError("This creation operation is not authorized.", 403);
    const spec = normalizeCreationSpec(JSON.parse(operation.inputJson));
    const { deployment } = operation;
    const assertAuthorized = async () => {
      const grant = await prisma.oAuthGrant.findUniqueOrThrow({ where: { id: operation.grantId }, include: { user: true } });
      assertCreationGrant(grant, grant.user, spec.hostId);
      if (!parseResourceIds(grant.resources).includes(deployment.id)) throw new HttpError("Creation grant no longer includes its reserved deployment.", 403);
      const current = await prisma.enrolledDeployment.findUniqueOrThrow({ where: { id: deployment.id } });
      if (current.vpsConfigId !== spec.hostId || current.legacyProjectId !== deployment.legacyProjectId || current.sourcePath !== deployment.sourcePath || current.projectGroupId !== deployment.projectGroupId || current.slug !== deployment.slug) throw new HttpError("The reserved deployment identity changed.", 409);
    };
    await assertAuthorized();
    if (operation.status !== "running" || deployment.status !== "pending" || deployment.composePath || !deployment.vpsConfig || !deployment.legacyProject || !deployment.projectGroupId || !deployment.sourcePath) throw new HttpError("Creation is not executable in its current state. Inspect before retrying.", 409);
    const claimed = await prisma.agentOperation.updateMany({ where: { id, status: "running", evidenceJson: null }, data: { evidenceJson: JSON.stringify({ phase: "creation_preflight", deploymentId: deployment.id }) } });
    if (claimed.count !== 1) return NextResponse.json({ uncertain: true, error: "This creation already started. Inspect before retrying." }, { status: 409 });
    const source = await inspectCreationSpec(spec);
    const response = await launchTemplateDeployment(user, {
      projectGroupId: deployment.projectGroupId, hostId: spec.hostId, environmentName: spec.environmentName,
      deploymentName: spec.name, templateName: "vps-caddy-existing-compose", repoUrl: spec.repositoryUrl, branch: spec.branch,
      inputs: { compose_file: spec.composeFile, domain: spec.domain, public_service: spec.publicService, public_port: spec.publicPort, health_path: spec.healthPath },
      // Values exist only server-side; the shared launch service stores them encrypted in GC.
      envVars: spec.generatedEnvironmentKeys.map(key => ({ key, value: randomBytes(32).toString("hex") })),
      createDns: false, delivery: { executor: spec.executor, workflowName: spec.workflowName, autoDeploy: spec.autoDeploy },
    }, {
      deploymentId: deployment.id, projectId: deployment.legacyProject.id, grantId: operation.grantId,
      sourcePath: deployment.sourcePath, spec, composeHash: source.composeHash,
      vps: { ...deployment.vpsConfig, privateKey: deployment.vpsConfig.privateKey ?? undefined, password: deployment.vpsConfig.password ?? undefined }, assertAuthorized,
    });
    const body = await response.json();
    if (!response.ok || !body.queued || typeof body.operationId !== "string") {
      // Never forward source, shell output, generated secrets or partial proxy/config payloads.
      return NextResponse.json({ success: false, error: typeof body.safeCreationError === "string" ? body.safeCreationError : "First-deployment preparation stopped. Its reserved target and any prepared files are retained for inspection; no automatic retry was scheduled.", deploymentId: deployment.id }, { status: response.status >= 500 ? 500 : 409 });
    }
    return NextResponse.json({ success: true, prepared: true, liveVerified: false, deploymentId: deployment.id, deliveryOperationId: body.operationId, publicUrl: `https://${spec.domain}`, commitSha: spec.commitSha });
  } catch (error) { return handleApiError(error); }
}
