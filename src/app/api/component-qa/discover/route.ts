import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readDeploymentOverrides } from "@/lib/deployment-evidence";
import { discoverContracts } from "@/lib/qa-harness/discover";
import { loadSourceFiles } from "@/lib/qa-harness/source-files";

function cleanText(value: unknown, max = 500): string {
  return String(value || "").trim().slice(0, max);
}

function publicBaseUrl(deployment: {
  metadataJson?: string | null;
  legacyProject?: { domain?: string | null } | null;
}): string | null {
  try {
    const metadata = JSON.parse(deployment.metadataJson || "{}") as { manualPublicUrl?: string };
    if (metadata.manualPublicUrl) return metadata.manualPublicUrl.replace(/\/+$/, "");
  } catch {}
  if (deployment.legacyProject?.domain) {
    return `https://${deployment.legacyProject.domain.replace(/\/+$/, "")}`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as {
      deploymentSlug?: string;
      component?: string;
      baseUrl?: string;
      seedPaths?: string[];
      probe?: boolean;
    };

    const deploymentSlug = cleanText(body.deploymentSlug, 120);
    const component = cleanText(body.component, 80);
    if (!deploymentSlug || !component) {
      return NextResponse.json({ error: "deploymentSlug and component are required" }, { status: 400 });
    }

    const deployment = await prisma.enrolledDeployment.findUnique({
      where: { slug: deploymentSlug },
      include: { legacyProject: { select: { domain: true } } },
    });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const baseUrl = cleanText(body.baseUrl, 1000) || publicBaseUrl(deployment);
    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required when the deployment has no public URL" }, { status: 400 });
    }

    const overrides = readDeploymentOverrides(deployment.metadataJson);
    const sourcePath = deployment.sourcePath?.trim();
    const sourceRoot = overrides.sourceRepair?.sourceRoot?.trim();
    const hostRoot = sourcePath
      ? sourceRoot
        ? `${sourcePath.replace(/\/+$/, "")}/${sourceRoot.replace(/^\/+/, "")}`
        : sourcePath
      : null;
    const revisionSha = overrides.sourceRepair?.deployedCommit?.trim() || null;

    const sourceFiles = hostRoot ? await loadSourceFiles(hostRoot) : [];
    const existing = await prisma.componentQACheck.findMany({
      where: { deploymentId: deployment.id },
      select: { method: true, path: true },
    });

    const seedPaths = Array.isArray(body.seedPaths)
      ? body.seedPaths.map((value) => cleanText(value, 500)).filter(Boolean)
      : [];

    const result = await discoverContracts({
      component,
      baseUrl,
      sourceFiles,
      seedPaths,
      existingChecks: existing.map((check) => ({ method: check.method, path: check.path })),
      revisionSha,
      probe: body.probe !== false,
    });

    const persisted: Array<Record<string, unknown>> = [];
    const existingKeys = new Set(existing.map((check) => `${check.method} ${check.path}`));
    for (const draft of result.drafts) {
      const key = `${draft.method} ${draft.path}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const created = await prisma.componentQACheck.create({
        data: {
          deploymentId: deployment.id,
          component: draft.component,
          name: draft.name,
          method: draft.method,
          path: draft.path,
          headers: JSON.stringify(draft.headers),
          body: draft.body,
          expectedStatus: draft.expectedStatus,
          expectedBodyContains: draft.expectedBodyContains,
          source: draft.source,
          status: "draft",
          evidenceRef: draft.evidenceRef,
          revisionSha: draft.revisionSha,
          enabled: true,
        },
      });
      persisted.push({
        id: created.id,
        component: created.component,
        name: created.name,
        method: created.method,
        path: created.path,
        expectedStatus: created.expectedStatus,
        source: created.source,
        status: created.status,
        evidenceRef: created.evidenceRef,
        confidence: draft.confidence,
        probed: draft.probed,
      });
    }

    return NextResponse.json({
      saved: persisted.length,
      drafts: persisted,
      sourceRoutesFound: result.sourceRoutesFound,
      probed: result.probed,
      warnings: result.warnings,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
