import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

function cleanText(value: unknown, max = 500): string {
  return String(value || "").trim().slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as {
      deploymentSlug?: string;
      component?: string;
      openApiUrl?: string;
      save?: boolean;
    };
    const deploymentSlug = cleanText(body.deploymentSlug, 120);
    const component = cleanText(body.component, 80);
    const openApiUrl = cleanText(body.openApiUrl, 1000);
    if (!deploymentSlug || !component || !openApiUrl) {
      return NextResponse.json({ error: "deploymentSlug, component, and openApiUrl are required" }, { status: 400 });
    }

    const deployment = await prisma.enrolledDeployment.findUnique({ where: { slug: deploymentSlug } });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const response = await fetch(openApiUrl);
    if (!response.ok) {
      return NextResponse.json({ error: `OpenAPI endpoint returned ${response.status}` }, { status: 400 });
    }
    const raw = await response.text();
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      try {
        doc = parseYaml(raw) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "OpenAPI document must be valid JSON or YAML" }, { status: 400 });
      }
    }
    const paths = doc.paths && typeof doc.paths === "object" && !Array.isArray(doc.paths)
      ? doc.paths as Record<string, Record<string, unknown>>
      : {};
    const suggestions = Object.entries(paths).flatMap(([path, methods]) => {
      if (!methods || typeof methods !== "object") return [];
      return Object.keys(methods)
        .filter((method) => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method))
        .map((method) => {
          const operation = methods[method] && typeof methods[method] === "object"
            ? methods[method] as Record<string, unknown>
            : {};
          const responses = operation.responses && typeof operation.responses === "object"
            ? operation.responses as Record<string, unknown>
            : {};
          const firstStatus = Object.keys(responses).find((status) => /^\d{3}$/.test(status));
          return {
            component,
            name: `${method.toUpperCase()} ${path}`,
            method: method.toUpperCase(),
            path,
            expectedStatus: firstStatus ? Number(firstStatus) : null,
            expectedBodyContains: null,
            headers: {},
            body: null,
          };
        });
    });

    if (body.save === true) {
      for (const suggestion of suggestions) {
        await prisma.componentQACheck.create({
          data: {
            deploymentId: deployment.id,
            component: suggestion.component,
            name: suggestion.name,
            method: suggestion.method,
            path: suggestion.path,
            headers: "{}",
            body: suggestion.body,
            expectedStatus: suggestion.expectedStatus,
            expectedBodyContains: suggestion.expectedBodyContains,
          },
        });
      }
    }

    return NextResponse.json({ suggestions, saved: body.save === true });
  } catch (err) {
    return handleApiError(err);
  }
}
