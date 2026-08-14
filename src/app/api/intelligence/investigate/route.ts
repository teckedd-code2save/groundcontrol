import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  resolveDeploymentEvidence,
  resolveDeploymentExecutionIdentity,
} from "@/lib/deployment-evidence";
import { scanProjectsTree } from "@/lib/project-scan";
import {
  getActiveVps,
  getDockerContainerLabels,
  getDockerContainers,
  scanProjects,
} from "@/lib/vps";

function hostname(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const domain = hostname(String(body.domain || ""));
    const deploymentSlug = String(body.deploymentSlug || "").trim();
    if (deploymentSlug && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(deploymentSlug)) {
      return NextResponse.json({ error: "A valid deployment identity is required." }, { status: 400 });
    }
    if (!domain && !deploymentSlug) {
      return NextResponse.json({ error: "A deployment identity or endpoint domain is required." }, { status: 400 });
    }
    const vps = await getActiveVps();
    if (!vps) return NextResponse.json({ error: "Connect and activate a host before investigating an endpoint." }, { status: 409 });

    const [tree, containers, labels, enrolled, hostProjects] = await Promise.all([
      scanProjectsTree(vps), getDockerContainers(vps), getDockerContainerLabels(vps),
      prisma.enrolledDeployment.findMany({ where: { vpsConfigId: vps.id }, include: { legacyProject: { include: { deployments: { orderBy: { createdAt: "desc" }, take: 1 } } } } }),
      scanProjects(vps),
    ]);
    const matches = enrolled.flatMap((deployment) => {
      const latestRelease = deployment.legacyProject?.deployments[0] || null;
      const evidence = resolveDeploymentEvidence({
        ...deployment,
        savedDomain: deployment.legacyProject?.domain,
        savedRepoUrl: deployment.legacyProject?.repoUrl,
        savedReleaseOutput: latestRelease?.output,
        savedProjectEnv: deployment.legacyProject?.envVars,
      }, containers, labels, tree.projects, hostProjects.caddySites);
      const identities = [deployment.legacyProject?.domain, evidence.publicUrl, evidence.route?.domain, latestRelease?.publicUrl, latestRelease?.previewUrl].map(hostname).filter(Boolean);
      const deploymentMatches = deploymentSlug
        ? deployment.slug === deploymentSlug || deployment.legacyProject?.slug === deploymentSlug
        : identities.includes(domain);
      if (!deploymentMatches) return [];
      const execution = resolveDeploymentExecutionIdentity({
        ...deployment,
        legacyProjectPath: deployment.legacyProject?.path,
        legacyProjectSlug: deployment.legacyProject?.slug,
      }, labels, evidence.runtime.containers.map((container) => container.name));
      const project = tree.projects.find((candidate) => candidate.path === execution.sourcePath)
        || tree.projects.find((candidate) => candidate.composePath === execution.composePath)
        || tree.projects.find((candidate) => candidate.path === deployment.legacyProject?.path)
        || tree.projects.find((candidate) => candidate.slug === deployment.legacyProject?.slug)
        || tree.projects.find((candidate) => candidate.slug === deployment.slug);
      return [{ deployment, evidence, execution, project, latestRelease }];
    });
    if (matches.length !== 1) return NextResponse.json({
      status: matches.length > 1 ? "ambiguous" : "unresolved", domain: domain || deploymentSlug,
      problem: matches.length > 1 ? `${matches.length} enrolled deployments claim this incident. GroundControl will not guess which one to change.` : "No enrolled deployment owns this incident, so GroundControl cannot safely prepare a runtime action.",
      uncertainty: matches.length > 1 ? matches.map((match) => match.deployment.slug) : ["The proxy route exists, but deployment inventory has no exact domain link."],
      fix: matches.length > 1 ? "Remove the duplicate domain assignment in Deployments." : "Link this endpoint to its deployment in Deployments, then investigate again.",
      verify: domain ? `Re-run the endpoint check for https://${domain}/ after the deployment identity is corrected.` : "Re-run the deployment investigation after its public endpoint is linked.",
    });

    const [{ deployment, evidence, execution, project, latestRelease }] = matches;
    const incidentDomain = domain || hostname(deployment.legacyProject?.domain || evidence.publicUrl || evidence.route?.domain || latestRelease?.publicUrl || latestRelease?.previewUrl);
    const runtime = evidence.runtime;
    const runtimeNames = runtime.containers.map((container) => container.name);
    const services = runtime.containers.map((container) => container.service).filter(Boolean);
    const route = evidence.route;
    const runtimeMissing = runtime.status !== "present";
    return NextResponse.json({
      status: "resolved", domain: incidentDomain || deployment.slug,
      problem: runtimeMissing ? `The proxy route for ${incidentDomain || deployment.slug} points to ${route?.proxy || "an unavailable upstream"}, but deployment ${deployment.slug} has no running linked runtime.` : `Deployment ${deployment.slug} has runtime evidence, but the proxy upstream ${route?.proxy || "target"} is not proving a healthy public path.`,
      target: { deploymentSlug: deployment.slug, deploymentName: deployment.name, sourcePath: execution.sourcePath || project?.path || null, composePath: execution.composePath || project?.composePath || null, composeProject: execution.composeProject || runtime.composeProject || null, composeServices: services.length > 0 ? services : project?.services.map((service) => service.name) || [], containers: runtimeNames, runtimeStatus: runtime.status, proxyRoute: route?.proxy || null, repository: evidence.repoUrl, deployedCommit: evidence.sourceRepair?.deployedCommit || latestRelease?.commitSha || evidence.sourceCommit || null, sourceRoot: evidence.sourceRepair?.sourceRoot || null, validationCommand: evidence.sourceRepair?.validationCommand || null, regressionCommand: evidence.sourceRepair?.regressionCommand || null, daytonaEnabled: evidence.sourceRepair?.daytonaEnabled !== false },
      fix: runtimeMissing
        ? "Restore this deployment from its exact Compose source. No code sandbox is justified for a missing runtime."
        : "Compare the reverse-proxy upstream with the actual Compose services, published ports, Docker networks, and health paths before proposing a restart or source change.",
      action: runtimeMissing && project ? { kind: "compose_up", projectSlug: deployment.legacyProject?.slug || project.slug, title: `Start ${deployment.name}`, risk: "medium", approvalRequired: true, rollback: `docker compose down for ${deployment.legacyProject?.slug || project.slug}` } : null,
      uncertainty: [
        !project ? "The enrolled deployment has no currently discovered Compose source." : null,
        !evidence.repoUrl ? "No GitHub repository identity is recorded. Link it here before a Daytona source inspection." : null,
      ].filter(Boolean),
      verify: incidentDomain ? `After an approved repair, GroundControl will check https://${incidentDomain}/ externally.` : "After an approved repair, GroundControl will verify the runtime and its linked public endpoint.",
    });
  } catch (error) { return handleApiError(error); }
}
