import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import {
  getProfileValues,
  parseEnvJson,
  parseEnvSchema,
  publicProfile,
  setLocalEnvValues,
  upsertEnvProfileForProject,
} from "@/lib/env-management";
import { discoverProjectEnv } from "@/lib/env-discovery";

function normalizeSchema(value: unknown) {
  if (Array.isArray(value)) return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    return typeof item.key === "string" ? [{ key: item.key, required: item.required !== false }] : [];
  });
  if (typeof value === "string") return parseEnvSchema(value);
  return [];
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const projectId = Number(searchParams.get("projectId") || 0);
    const deploymentId = Number(searchParams.get("deploymentId") || 0);
    let project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
    if (!project && deploymentId) {
      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId }, include: { project: true } });
      project = deployment?.project || null;
    }
    if (!project) return NextResponse.json({ error: "projectId or deploymentId is required" }, { status: 400 });
    const profile = await upsertEnvProfileForProject({ projectId: project.id, deploymentId: deploymentId || undefined });
    const values = await getProfileValues(profile.id);
    const discovered = await discoverProjectEnv(project).catch(() => ({ entries: [], values: {} }));
    return NextResponse.json({
      profile: publicProfile(profile, values, parseEnvJson(profile.schemaJson)),
      discovered: { entries: discovered.entries },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const projectId = Number(body.projectId || 0);
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    const schema = normalizeSchema(body.schema);
    const profile = await upsertEnvProfileForProject({
      projectId,
      deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
      schema,
      providerType: body.providerType || "local",
      providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : null,
      environment: body.environment || "prod",
      secretPath: body.secretPath || "/",
      projectRef: body.projectRef || "",
    });
    if (body.importCurrentServerEnv) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
      const discovered = await discoverProjectEnv(project);
      const nextSchema = mergeSchema(schema, Object.keys(discovered.values));
      const updated = await upsertEnvProfileForProject({
        projectId,
        deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
        schema: nextSchema,
        providerType: body.providerType || "local",
        providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : null,
        environment: body.environment || "prod",
        secretPath: body.secretPath || "/",
        projectRef: body.projectRef || "",
      });
      await setLocalEnvValues(updated.id, discovered.values, nextSchema);
      const values = await getProfileValues(updated.id);
      return NextResponse.json({
        profile: publicProfile(updated, values, parseEnvJson(updated.schemaJson)),
        discovered: { entries: discovered.entries },
      });
    }
    if (body.values && typeof body.values === "object") {
      await setLocalEnvValues(profile.id, body.values, schema);
    }
    const values = await getProfileValues(profile.id);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    const discovered = project ? await discoverProjectEnv(project).catch(() => ({ entries: [], values: {} })) : { entries: [], values: {} };
    return NextResponse.json({
      profile: publicProfile(profile, values, parseEnvJson(profile.schemaJson)),
      discovered: { entries: discovered.entries },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function mergeSchema(schema: { key: string; required: boolean }[], keys: string[]) {
  const seen = new Set(schema.map((entry) => entry.key));
  const merged = [...schema];
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ key, required: true });
    }
  }
  return merged;
}
