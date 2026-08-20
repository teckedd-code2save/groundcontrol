import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

function cleanText(value: unknown, max = 500): string {
  return String(value || "").trim().slice(0, max);
}

function publicBaseUrl(deployment: {
  metadataJson?: string | null;
  legacyProject?: { domain?: string | null } | null;
}): string | null {
  try {
    const metadata = JSON.parse(deployment.metadataJson || "{}") as { manualPublicUrl?: string };
    if (metadata.manualPublicUrl) return metadata.manualPublicUrl.replace(/\/$/, "");
  } catch {}
  if (deployment.legacyProject?.domain) return `https://${deployment.legacyProject.domain.replace(/\/$/, "")}`;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as {
      deploymentSlug?: string;
      component?: string;
      baseUrl?: string;
    };
    const deploymentSlug = cleanText(body.deploymentSlug, 120);
    const component = cleanText(body.component, 80);
    if (!deploymentSlug) return NextResponse.json({ error: "deploymentSlug required" }, { status: 400 });

    const deployment = await prisma.enrolledDeployment.findUnique({
      where: { slug: deploymentSlug },
      include: { legacyProject: { select: { domain: true } } },
    });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const baseUrl = cleanText(body.baseUrl, 1000) || publicBaseUrl(deployment);
    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required when the deployment has no public URL" }, { status: 400 });
    }

    const checks = await prisma.componentQACheck.findMany({
      where: { deploymentId: deployment.id, enabled: true, status: "active", ...(component ? { component } : {}) },
      orderBy: [{ component: "asc" }, { name: "asc" }],
    });

    const results: Array<Record<string, unknown>> = [];
    for (const check of checks) {
      const url = `${baseUrl}${check.path.startsWith("/") ? "" : "/"}${check.path}`;
      let headers: Record<string, string> = {};
      try { headers = JSON.parse(check.headers || "{}"); } catch {}
      const started = Date.now();
      try {
        const response = await fetch(url, {
          method: check.method,
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: check.body && check.method !== "GET" && check.method !== "HEAD" ? check.body : undefined,
        });
        const responseText = await response.text();
        const statusOk = check.expectedStatus == null || response.status === check.expectedStatus;
        const bodyOk = check.expectedBodyContains
          ? responseText.includes(check.expectedBodyContains)
          : true;
        const passed = statusOk && bodyOk;
        results.push({
          checkId: check.id,
          component: check.component,
          name: check.name,
          method: check.method,
          path: check.path,
          statusCode: response.status,
          passed,
          durationMs: Date.now() - started,
          bodyPreview: responseText.slice(0, 500),
        });
      } catch (error) {
        results.push({
          checkId: check.id,
          component: check.component,
          name: check.name,
          method: check.method,
          path: check.path,
          passed: false,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const passed = results.length > 0 && results.every((result) => result.passed === true);
    const run = await prisma.componentQARun.create({
      data: {
        deploymentId: deployment.id,
        component: component || "all",
        status: results.length === 0 ? "failed" : passed ? "passed" : "failed",
        output: JSON.stringify({ baseUrl, results }, null, 2),
        error: results.length === 0 ? "No enabled QA checks found." : null,
      },
    });

    return NextResponse.json({ run, results, passed });
  } catch (err) {
    return handleApiError(err);
  }
}
