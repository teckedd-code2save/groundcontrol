import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { resolveDeploymentEvidence } from "@/lib/deployment-evidence";
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
    if (!domain) return NextResponse.json({ error: "A valid endpoint domain is required." }, { status: 400 });
    const vps = await getActiveVps();
    if (!vps) return NextResponse.json({ error: "Connect and activate a host before investigating an endpoint." }, { status: 409 });

    const [tree, containers, labels, enrolled, hostProjects] = await Promise.all([
      scanProjectsTree(vps), getDockerContainers(vps), getDockerContainerLabels(vps),
      prisma.enrolledDeployment.findMany({ where: { vpsConfigId: vps.id }, include: { legacyProject: { include: { deployments: { orderBy: { createdAt: "desc" }, take: 1 } } } } }),
      scanProjects(vps),
    ]);
    const matches = enrolled.flatMap((deployment) => {
      const latestRelease = deployment.legacyProject?.deployments[0] || null;
      const evidence = resolveDeploymentEvidence({ ...deployment, savedDomain: deployment.legacyProject?.domain, savedRepoUrl: deployment.legacyProject?.repoUrl }, containers, labels, tree.projects, hostProjects.caddySites);
      const identities = [deployment.legacyProject?.domain, evidence.publicUrl, evidence.route?.domain, latestRelease?.publicUrl, latestRelease?.previewUrl].map(hostname).filter(Boolean);
      if (!identities.includes(domain)) return [];
      const project = tree.projects.find((candidate) => candidate.path === deployment.sourcePath) || tree.projects.find((candidate) => candidate.slug === deployment.slug);
      return [{ deployment, evidence, project, latestRelease }];
    });
    if (matches.length !== 1) return NextResponse.json({
      status: matches.length > 1 ? "ambiguous" : "unresolved", domain,
      problem: matches.length > 1 ? `${matches.length} enrolled deployments claim this endpoint. GroundControl will not guess which one to change.` : "No enrolled deployment owns this endpoint, so GroundControl cannot safely prepare a runtime action.",
      uncertainty: matches.length > 1 ? matches.map((match) => match.deployment.slug) : ["The proxy route exists, but deployment inventory has no exact domain link."],
      fix: matches.length > 1 ? "Remove the duplicate domain assignment in Deployments." : "Link this endpoint to its deployment in Deployments, then investigate again.",
      verify: `Re-run the endpoint check for https://${domain}/ after the deployment identity is corrected.`,
    });

    const [{ deployment, evidence, project, latestRelease }] = matches;
    const runtime = evidence.runtime;
    const runtimeNames = runtime.containers.map((container) => container.name);
    const services = runtime.containers.map((container) => container.service).filter(Boolean);
    const route = evidence.route;
    const runtimeMissing = runtime.status !== "present";
    return NextResponse.json({
      status: "resolved", domain,
      problem: runtimeMissing ? `The proxy route for ${domain} points to ${route?.proxy || "an unavailable upstream"}, but deployment ${deployment.slug} has no running linked runtime.` : `Deployment ${deployment.slug} is linked, but its route-to-runtime path is still failing.`,
      target: { deploymentSlug: deployment.slug, deploymentName: deployment.name, sourcePath: deployment.sourcePath, composePath: deployment.composePath || project?.composePath || null, composeProject: runtime.composeProject || null, composeServices: services.length > 0 ? services : project?.services.map((service) => service.name) || [], containers: runtimeNames, runtimeStatus: runtime.status, proxyRoute: route?.proxy || null, repository: evidence.repoUrl, deployedCommit: latestRelease?.commitSha || null },
      fix: runtimeMissing ? "Restore this deployment from its exact Compose source. No code sandbox is justified for a missing runtime." : "Inspect only this deployment's failing containers and route before proposing a repository change.",
      action: runtimeMissing && project ? { kind: "compose_up", projectSlug: project.slug, title: `Start ${deployment.name}`, risk: "medium", approvalRequired: true, rollback: `docker compose down for ${project.slug}` } : null,
      uncertainty: [!project ? "The enrolled deployment has no currently discovered Compose source." : null].filter(Boolean),
      verify: `After an approved repair, GroundControl will check https://${domain}/ externally.`,
    });
  } catch (error) { return handleApiError(error); }
}
