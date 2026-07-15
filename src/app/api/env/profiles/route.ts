import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import {
  getProfileValues,
  getProfileValuesByComponent,
  deleteLocalEnvValues,
  listDeploymentEnvironments,
  normalizeEnvironmentSlug,
  parseEnvJson,
  parseEnvSchema,
  publicProfile,
  removeEnvSchemaEntries,
  resolveDeploymentEnv,
  setLocalEnvValues,
  upsertEnvProfileForProject,
  type EnvSchemaEntry,
} from "@/lib/env-management";
import { parseComposeServices } from "@/lib/project-scan";

function normalizeSchema(value: unknown): EnvSchemaEntry[] {
  if (Array.isArray(value)) return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.key !== "string" || !validKey(item.key)) return [];
    const component = typeof item.component === "string" && validComponent(item.component)
      ? item.component
      : undefined;
    return [{ key: item.key, required: item.required !== false, component }];
  });
  if (typeof value === "string") return parseEnvSchema(value);
  return [];
}

function validKey(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validComponent(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function normalizeComponent(value: unknown): string {
  const component = typeof value === "string" ? value.trim() : "";
  if (!component) return "";
  if (!validComponent(component)) throw new Error("Invalid component name");
  return component;
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const { searchParams } = new URL(req.url);
    const projectId = Number(searchParams.get("projectId") || 0);
    const deploymentId = Number(searchParams.get("deploymentId") || 0);
    const environmentSlug = searchParams.get("environment") || undefined;
    let project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
    if (!project && deploymentId) {
      const deployment = await prisma.deployment.findUnique({
        where: { id: deploymentId },
        include: { project: true },
      });
      project = deployment?.project || null;
    }
    if (!project) {
      return NextResponse.json({ error: "projectId or deploymentId is required" }, { status: 400 });
    }

    const profile = environmentSlug
      ? await prisma.deploymentEnvProfile.findFirst({
          where: { projectId: project.id, slug: normalizeEnvironmentSlug(environmentSlug) },
        })
      : await upsertEnvProfileForProject({
          projectId: project.id,
          deploymentId: deploymentId || undefined,
        });
    if (!profile) return NextResponse.json({ error: "Deployment environment not found" }, { status: 404 });
    const [storedValues, storedComponentValues, environments] = await Promise.all([
      getProfileValues(profile.id),
      getProfileValuesByComponent(profile.id),
      listDeploymentEnvironments(project.id),
    ]);
    let values = storedValues;
    let componentValues = storedComponentValues;
    let providerError: string | null = null;
    if (profile.providerType === "infisical") {
      try {
        const resolved = await resolveDeploymentEnv(project, profile.slug);
        if (resolved) {
          values = resolved.values;
          componentValues = resolved.componentValues;
        }
      } catch (error) {
        providerError = error instanceof Error ? error.message : "Infisical could not be reached";
      }
    }
    return NextResponse.json({
      profile: profileResponse(profile, values, componentValues),
      environments: environments.map(publicEnvironment),
      components: listComponents(project.dockerCompose, componentValues, parseEnvJson(profile.schemaJson)),
      providerError,
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
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    if (body.action === "create-environment") {
      const name = String(body.name || "").trim();
      const slug = normalizeEnvironmentSlug(body.slug || name);
      if (!name) return NextResponse.json({ error: "Environment name is required" }, { status: 400 });
      const duplicate = await prisma.deploymentEnvProfile.findFirst({ where: { projectId, slug } });
      if (duplicate) return NextResponse.json({ error: `An environment named ${duplicate.name} already exists` }, { status: 409 });
      const source = body.copyFromProfileId
        ? await prisma.deploymentEnvProfile.findFirst({
            where: { id: Number(body.copyFromProfileId), projectId },
          })
        : await prisma.deploymentEnvProfile.findFirst({
            where: { projectId },
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
          });
      const created = await upsertEnvProfileForProject({
        projectId,
        deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
        name,
        environmentSlug: slug,
        isDefault: !source,
        schema: parseEnvJson(source?.schemaJson).filter((entry) => entry.component),
        providerType: source?.providerType || "local",
        providerAccountId: source?.providerAccountId,
        environment: String(body.providerEnvironment || slug),
        secretPath: source?.secretPath || "/",
        projectRef: source?.projectRef || "",
      });
      return NextResponse.json({
        profile: profileResponse(created, {}, {}),
        environments: (await listDeploymentEnvironments(projectId)).map(publicEnvironment),
        components: listComponents(project.dockerCompose, {}, parseEnvJson(created.schemaJson)),
        action: "created",
      }, { status: 201 });
    }

    const component = normalizeComponent(body.componentName);
    const changesValues = body.values && typeof body.values === "object";
    if (body.reconcile === true || body.importCurrentServerEnv === true || body.action === "assign-legacy-key") {
      return NextResponse.json({
        error: "GroundControl does not infer secrets from host files or running containers. Add them explicitly or import an environment file.",
      }, { status: 400 });
    }
    const changesRuntimeState = changesValues || Array.isArray(body.deleteKeys);
    if (changesRuntimeState && !component) {
      return NextResponse.json({
        error: "Choose the component that should receive these values. GroundControl no longer creates shared deployment variables.",
      }, { status: 400 });
    }
    const submittedSchema = normalizeSchema(body.schema);
    const environmentSlug = normalizeEnvironmentSlug(body.environmentSlug || "production");
    const existingProfile = body.profileId
      ? await prisma.deploymentEnvProfile.findFirst({ where: { id: Number(body.profileId), projectId } })
      : await prisma.deploymentEnvProfile.findFirst({ where: { projectId, slug: environmentSlug } });
    if (!existingProfile) return NextResponse.json({ error: "Deployment environment not found" }, { status: 404 });
    const existingSchema = parseEnvJson(existingProfile?.schemaJson);
    let schema = mergeSchema(existingSchema, submittedSchema);
    let profile = await upsertEnvProfileForProject({
      projectId,
      profileId: existingProfile.id,
      deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
      name: body.name || existingProfile.name,
      environmentSlug: existingProfile.slug,
      isDefault: body.isDefault === true ? true : existingProfile.isDefault,
      schema,
      providerType: body.providerType || existingProfile.providerType,
      providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : existingProfile.providerAccountId,
      environment: body.providerEnvironment || body.environment || existingProfile.environment,
      secretPath: body.secretPath || existingProfile.secretPath,
      projectRef: body.projectRef || existingProfile.projectRef,
    });
    let action = "saved";
    const deleteKeys = Array.isArray(body.deleteKeys)
      ? body.deleteKeys.filter((key: unknown): key is string => typeof key === "string" && validKey(key))
      : [];
    if (deleteKeys.length > 0) {
      schema = removeEnvSchemaEntries(schema, deleteKeys, component);
      profile = await upsertEnvProfileForProject({
        projectId,
        profileId: profile.id,
        deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
        name: profile.name,
        environmentSlug: profile.slug,
        isDefault: profile.isDefault,
        schema,
        providerType: body.providerType || profile.providerType,
        providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : profile.providerAccountId,
        environment: body.providerEnvironment || body.environment || profile.environment,
        secretPath: body.secretPath || profile.secretPath,
        projectRef: body.projectRef || profile.projectRef,
      });
      await deleteLocalEnvValues(profile.id, deleteKeys, component);
      action = "deleted";
    } else if (body.values && typeof body.values === "object") {
      const submittedValues = Object.fromEntries(
        Object.entries(body.values as Record<string, unknown>)
          .filter(([key, value]) => validKey(key) && typeof value === "string")
      ) as Record<string, string>;
      schema = mergeSchema(schema, Object.keys(submittedValues).map((key) => ({
        key,
        required: true,
        component: component || undefined,
      })));
      profile = await upsertEnvProfileForProject({
        projectId,
        profileId: profile.id,
        deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
        name: profile.name,
        environmentSlug: profile.slug,
        isDefault: profile.isDefault,
        schema,
        providerType: body.providerType || profile.providerType,
        providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : profile.providerAccountId,
        environment: body.providerEnvironment || body.environment || profile.environment,
        secretPath: body.secretPath || profile.secretPath,
        projectRef: body.projectRef || profile.projectRef,
      });
      await setLocalEnvValues(profile.id, submittedValues, schema, component);
    }

    const [values, componentValues] = await Promise.all([
      getProfileValues(profile.id),
      getProfileValuesByComponent(profile.id),
    ]);
    profile = await prisma.deploymentEnvProfile.update({
      where: { id: profile.id },
      data: {
        status: action === "saved" && !changesRuntimeState ? profile.status : "ready",
        lastError: null,
      },
    });

    return NextResponse.json({
      profile: profileResponse(profile, values, componentValues),
      environments: (await listDeploymentEnvironments(projectId)).map(publicEnvironment),
      components: listComponents(project.dockerCompose, componentValues, parseEnvJson(profile.schemaJson)),
      action,
      materialized: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function profileResponse(
  profile: Parameters<typeof publicProfile>[0],
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>
) {
  return publicProfile(profile, values, parseEnvJson(profile.schemaJson), componentValues);
}

function publicEnvironment(profile: {
  id: number;
  name: string;
  slug: string;
  isDefault: boolean;
  providerType: string;
  providerAccountId: number | null;
  environment: string;
  status: string;
  lastSyncedAt: Date | null;
}) {
  return {
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    isDefault: profile.isDefault,
    providerType: profile.providerType,
    providerAccountId: profile.providerAccountId,
    providerEnvironment: profile.environment,
    status: profile.status,
    lastSyncedAt: profile.lastSyncedAt,
  };
}

function listComponents(
  composeContent: string | null | undefined,
  componentValues: Record<string, Record<string, string>>,
  schema: EnvSchemaEntry[] = []
) {
  const composeComponents = parseComposeServices(composeContent || "").services.map((service) => service.name);
  return Array.from(new Set([
    ...composeComponents,
    ...Object.keys(componentValues),
    ...schema.flatMap((entry) => entry.component ? [entry.component] : []),
  ])).sort();
}

function mergeSchema(base: EnvSchemaEntry[], additions: EnvSchemaEntry[]) {
  const merged = [...base];
  const seen = new Set(base.map((entry) => `${entry.component || ""}:${entry.key}`));
  for (const entry of additions) {
    const id = `${entry.component || ""}:${entry.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(entry);
  }
  return merged;
}
