import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

function cleanText(value: unknown, max = 500): string {
  return String(value || "").trim().slice(0, max);
}

function parseHeaders(value: unknown): Record<string, string> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : {};
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  return {};
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const deploymentSlug = searchParams.get("deploymentSlug")?.trim() || "";
    const component = searchParams.get("component")?.trim() || "";
    if (!deploymentSlug) return NextResponse.json({ error: "deploymentSlug required" }, { status: 400 });

    const deployment = await prisma.enrolledDeployment.findUnique({ where: { slug: deploymentSlug } });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const checks = await prisma.componentQACheck.findMany({
      where: {
        deploymentId: deployment.id,
        ...(component ? { component } : {}),
      },
      orderBy: [{ component: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ checks });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;
    const deploymentSlug = cleanText(body.deploymentSlug, 120);
    const component = cleanText(body.component, 80);
    const name = cleanText(body.name, 160);
    const method = cleanText(body.method, 10).toUpperCase() || "GET";
    const path = cleanText(body.path, 500);
    if (!deploymentSlug || !component || !name || !path) {
      return NextResponse.json({ error: "deploymentSlug, component, name, and path are required" }, { status: 400 });
    }
    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
      return NextResponse.json({ error: "Unsupported HTTP method" }, { status: 400 });
    }

    const deployment = await prisma.enrolledDeployment.findUnique({ where: { slug: deploymentSlug } });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const headers = JSON.stringify(parseHeaders(body.headers));
    const expectedStatus = body.expectedStatus == null ? null : Number(body.expectedStatus);
    if (expectedStatus !== null && (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599)) {
      return NextResponse.json({ error: "expectedStatus must be a valid HTTP status" }, { status: 400 });
    }
    const checkId = body.checkId ? Number(body.checkId) : null;
    const data = {
      deploymentId: deployment.id,
      component,
      name,
      method,
      path,
      headers,
      body: body.body == null ? null : String(body.body),
      expectedStatus,
      expectedBodyContains: body.expectedBodyContains == null ? null : cleanText(body.expectedBodyContains, 500),
      enabled: body.enabled !== false,
    };

    const check = checkId
      ? await prisma.componentQACheck.update({ where: { id: checkId }, data })
      : await prisma.componentQACheck.create({ data });
    return NextResponse.json({ check }, { status: checkId ? 200 : 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
