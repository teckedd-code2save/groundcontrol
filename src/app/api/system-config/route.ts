import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveVps, getSystemConfig, invalidateSystemConfigCache, execOnVps } from "@/lib/vps";

// Whitelist of editable path fields so a request can't set vpsConfigId/id directly.
const PATH_FIELDS = [
  "projectRoot",
  "templateDeploymentRoot",
  "caddySitesDir",
  "caddyFile",
  "nginxSitesDir",
  "nginxLogPath",
  "staticRoot",
  "sshDefaultCwd",
  "certDomain",
  "composeCommand",
] as const;

type PathData = Partial<Record<(typeof PATH_FIELDS)[number], string | null>>;

type SystemConfigInput = {
  [K in (typeof PATH_FIELDS)[number]]: K extends "composeCommand" ? string | null : string | undefined;
};

function shQuoteLocal(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function pickPathFields(data: unknown): PathData {
  const out: PathData = {};
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of PATH_FIELDS) {
      if (record[key] !== undefined) out[key] = record[key] as string | null;
    }
  }
  return out;
}

/** Convert nullable path data into Prisma-compatible input (null -> undefined for required fields). */
function toPrismaData(data: PathData): SystemConfigInput {
  const out: SystemConfigInput = {} as SystemConfigInput;
  for (const key of PATH_FIELDS) {
    const value = data[key];
    if (key === "composeCommand") {
      (out as Record<string, string | null>)[key] = value ?? null;
    } else {
      (out as Record<string, string | undefined>)[key] = value || undefined;
    }
  }
  return out;
}

// Directories that should exist on the active VPS for the layout to be valid.
const DIR_FIELDS = [
  "projectRoot",
  "templateDeploymentRoot",
  "caddySitesDir",
  "nginxSitesDir",
  "staticRoot",
  "sshDefaultCwd",
] as const;

async function validateDirectories(data: PathData): Promise<string[]> {
  const warnings: string[] = [];
  let conn;
  try {
    conn = await getActiveVps();
  } catch {
    return ["No active VPS to validate paths against"];
  }
  if (!conn) return ["No active VPS to validate paths against"];

  for (const key of DIR_FIELDS) {
    const path = data[key];
    if (!path || typeof path !== "string") continue;
    try {
      const quoted = shQuoteLocal(path);
      const result = await execOnVps(`test -d ${quoted} && echo yes || echo no`, conn);
      if (result.stdout.trim() !== "yes") {
        if (key === "templateDeploymentRoot") {
          const mkdir = await execOnVps(`mkdir -p ${quoted} && chmod 755 ${quoted} && echo yes || echo no`, conn);
          if (mkdir.stdout.trim() !== "yes") warnings.push(`${key}: ${path} does not exist and could not be created on the active VPS`);
        } else {
          warnings.push(`${key}: ${path} does not exist on the active VPS`);
        }
      }
    } catch {
      warnings.push(`${key}: could not verify ${path}`);
    }
  }
  return warnings;
}

export async function GET() {
  try {
    // Resolves the config for the active VPS (per-VPS filesystem layout).
    const config = await getSystemConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = pickPathFields(await req.json());
    const prismaData = toPrismaData(data);
    const { searchParams } = new URL(req.url);
    const shouldValidate = searchParams.get("validate") === "1" || searchParams.get("validate") === "true";

    // Determine which VPS these paths belong to.
    let activeVpsId: number | null = null;
    try {
      const active = await getActiveVps();
      activeVpsId = active?.id ?? null;
    } catch {
      activeVpsId = null;
    }

    let warnings: string[] = [];
    if (shouldValidate) {
      warnings = await validateDirectories(data);
    }

    let config;
    try {
      if (activeVpsId !== null) {
        // Per-VPS config row (one per VPS).
        const existing = await prisma.systemConfig.findUnique({
          where: { vpsConfigId: activeVpsId },
        });
        if (existing) {
          config = await prisma.systemConfig.update({
            where: { id: existing.id },
            data: { ...prismaData, updatedAt: new Date() },
          });
        } else {
          // Adopt a legacy global row for this VPS if present, else create new.
          const globalRow = await prisma.systemConfig.findFirst({
            where: { vpsConfigId: null },
          });
          if (globalRow) {
            config = await prisma.systemConfig.update({
              where: { id: globalRow.id },
              data: { ...prismaData, vpsConfigId: activeVpsId, updatedAt: new Date() },
            });
          } else {
            config = await prisma.systemConfig.create({
              data: { ...prismaData, vpsConfigId: activeVpsId },
            });
          }
        }
      } else {
        // No active VPS — fall back to a single global row.
        const existing = await prisma.systemConfig.findFirst({ where: { vpsConfigId: null } });
        if (existing) {
          config = await prisma.systemConfig.update({
            where: { id: existing.id },
            data: { ...prismaData, updatedAt: new Date() },
          });
        } else {
          config = await prisma.systemConfig.create({ data: prismaData });
        }
      }
    } catch {
      // Table may not exist — return the submitted data as the effective config
      config = { ...prismaData, id: 0, updatedAt: new Date() };
    }
    invalidateSystemConfigCache();
    return NextResponse.json({ ...config, warnings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
