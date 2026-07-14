import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import {
  getProfileValues,
  getProfileValuesByComponent,
  materializeEnvBundle,
  parseEnvJson,
  parseEnvSchema,
  publicProfile,
  setLocalEnvValues,
  upsertEnvProfileForProject,
  type EnvSchemaEntry,
} from "@/lib/env-management";
import {
  discoverProjectEnv,
  type DiscoveredEnvResult,
} from "@/lib/env-discovery";

const EMPTY_DISCOVERY: DiscoveredEnvResult = {
  entries: [],
  values: {},
  scopedValues: {},
  summary: {
    containerCount: 0,
    runningContainerCount: 0,
    runtimeKeyCount: 0,
    declaredKeyCount: 0,
  },
};

const RUNTIME_NOISE_KEYS = new Set([
  "HOME", "HOSTNAME", "PATH", "PWD", "SHLVL", "TERM", "USER", "LOGNAME", "_",
]);

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
    const reveal = searchParams.get("reveal") === "true";
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

    const profile = await upsertEnvProfileForProject({
      projectId: project.id,
      deploymentId: deploymentId || undefined,
    });
    const [values, componentValues, discovered] = await Promise.all([
      getProfileValues(profile.id),
      getProfileValuesByComponent(profile.id),
      discoverProjectEnv(project).catch(() => EMPTY_DISCOVERY),
    ]);
    return NextResponse.json({
      profile: profileResponse(profile, values, componentValues, reveal),
      discovered: publicDiscovery(discovered, reveal),
      components: listComponents(discovered, componentValues),
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

    const component = normalizeComponent(body.componentName);
    const submittedSchema = normalizeSchema(body.schema);
    const existingProfile = await prisma.deploymentEnvProfile.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
    });
    const existingSchema = parseEnvJson(existingProfile?.schemaJson);
    let schema = mergeSchema(existingSchema, submittedSchema);
    let profile = await upsertEnvProfileForProject({
      projectId,
      deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
      schema,
      providerType: body.providerType || "local",
      providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : null,
      environment: body.environment || "prod",
      secretPath: body.secretPath || "/",
      projectRef: body.projectRef || "",
    });
    const discovered = await discoverProjectEnv(project).catch(() => EMPTY_DISCOVERY);

    let action = "saved";
    if (body.reconcile === true || body.importCurrentServerEnv === true) {
      const bundle = buildReconciledBundle(discovered, component || undefined);
      schema = mergeSchema(schema, schemaForBundle(bundle));
      profile = await upsertEnvProfileForProject({
        projectId,
        deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
        schema,
        providerType: body.providerType || "local",
        providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : null,
        environment: body.environment || "prod",
        secretPath: body.secretPath || "/",
        projectRef: body.projectRef || "",
      });
      if (Object.keys(bundle.deployment).length > 0) {
        await setLocalEnvValues(profile.id, bundle.deployment, schema);
      }
      for (const [name, scoped] of Object.entries(bundle.components)) {
        await setLocalEnvValues(profile.id, scoped, schema, name);
      }
      action = "reconciled";
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
        deploymentId: body.deploymentId ? Number(body.deploymentId) : undefined,
        schema,
        providerType: body.providerType || "local",
        providerAccountId: body.providerAccountId ? Number(body.providerAccountId) : null,
        environment: body.environment || "prod",
        secretPath: body.secretPath || "/",
        projectRef: body.projectRef || "",
      });
      await setLocalEnvValues(profile.id, submittedValues, schema, component);
    }

    const [values, componentValues] = await Promise.all([
      getProfileValues(profile.id),
      getProfileValuesByComponent(profile.id),
    ]);
    let materialized: { hash: string; files: string[] } | null = null;
    if (profile.providerType === "local" && project.path && (action === "reconciled" || body.values)) {
      materialized = await materializeEnvBundle(project.path, values, componentValues);
      profile = await prisma.deploymentEnvProfile.update({
        where: { id: profile.id },
        data: {
          status: "synced",
          lastHash: materialized.hash,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
    }

    return NextResponse.json({
      profile: profileResponse(profile, values, componentValues, false),
      discovered: publicDiscovery(discovered, false),
      components: listComponents(discovered, componentValues),
      action,
      materialized,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function profileResponse(
  profile: Parameters<typeof publicProfile>[0],
  values: Record<string, string>,
  componentValues: Record<string, Record<string, string>>,
  reveal: boolean
) {
  const result = publicProfile(profile, values, parseEnvJson(profile.schemaJson), componentValues);
  if (!reveal) return result;
  return {
    ...result,
    values: revealValues(values),
    componentValues: Object.fromEntries(
      Object.entries(componentValues).map(([component, scoped]) => [component, revealValues(scoped)])
    ),
  };
}

function revealValues(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { masked: value, hasValue: !!value }])
  );
}

function publicDiscovery(discovered: DiscoveredEnvResult, reveal: boolean) {
  return {
    entries: discovered.entries,
    summary: discovered.summary,
    ...(reveal ? { values: discovered.values, scopedValues: discovered.scopedValues } : {}),
  };
}

function listComponents(
  discovered: DiscoveredEnvResult,
  componentValues: Record<string, Record<string, string>>
) {
  return Array.from(new Set([
    ...discovered.entries.flatMap((entry) => entry.component ? [entry.component] : []),
    ...Object.keys(componentValues),
  ])).sort();
}

function buildReconciledBundle(discovered: DiscoveredEnvResult, onlyComponent?: string) {
  const deployment: Record<string, string> = {};
  const components: Record<string, Record<string, string>> = {};
  const declared = new Set(
    discovered.entries
      .filter((entry) => !entry.runtime)
      .map((entry) => `${entry.component || ""}:${entry.key}`)
  );

  for (const entry of discovered.entries) {
    if (!entry.hasValue) continue;
    if (entry.runtime && RUNTIME_NOISE_KEYS.has(entry.key)) continue;
    if (entry.runtime && !declared.has(`${entry.component || ""}:${entry.key}`) && entry.key.startsWith("LC_")) continue;
    if (entry.component) {
      if (onlyComponent && entry.component !== onlyComponent) continue;
      const value = discovered.scopedValues[`${entry.component}:${entry.key}`];
      if (value === undefined) continue;
      const scoped = components[entry.component] || {};
      scoped[entry.key] = value;
      components[entry.component] = scoped;
    } else if (!onlyComponent) {
      const value = discovered.scopedValues[entry.key] ?? discovered.values[entry.key];
      if (value !== undefined) deployment[entry.key] = value;
    }
  }
  return { deployment, components };
}

function schemaForBundle(bundle: {
  deployment: Record<string, string>;
  components: Record<string, Record<string, string>>;
}): EnvSchemaEntry[] {
  return [
    ...Object.keys(bundle.deployment).map((key) => ({ key, required: true })),
    ...Object.entries(bundle.components).flatMap(([component, values]) =>
      Object.keys(values).map((key) => ({ key, required: true, component }))
    ),
  ];
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
