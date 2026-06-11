import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveVps, getSystemConfig, invalidateSystemConfigCache } from "@/lib/vps";

// Whitelist of editable path fields so a request can't set vpsConfigId/id directly.
const PATH_FIELDS = [
  "projectRoot",
  "caddySitesDir",
  "caddyFile",
  "nginxSitesDir",
  "nginxLogPath",
  "staticRoot",
  "sshDefaultCwd",
  "certDomain",
  "composeCommand",
] as const;

function pickPathFields(data: any) {
  const out: any = {};
  for (const key of PATH_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

export async function GET() {
  try {
    // Resolves the config for the active VPS (per-VPS filesystem layout).
    const config = await getSystemConfig();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = pickPathFields(await req.json());

    // Determine which VPS these paths belong to.
    let activeVpsId: number | null = null;
    try {
      const active = await getActiveVps();
      activeVpsId = active?.id ?? null;
    } catch {
      activeVpsId = null;
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
            data: { ...data, updatedAt: new Date() },
          });
        } else {
          // Adopt a legacy global row for this VPS if present, else create new.
          const globalRow = await prisma.systemConfig.findFirst({
            where: { vpsConfigId: null },
          });
          if (globalRow) {
            config = await prisma.systemConfig.update({
              where: { id: globalRow.id },
              data: { ...data, vpsConfigId: activeVpsId, updatedAt: new Date() },
            });
          } else {
            config = await prisma.systemConfig.create({
              data: { ...data, vpsConfigId: activeVpsId },
            });
          }
        }
      } else {
        // No active VPS — fall back to a single global row.
        const existing = await prisma.systemConfig.findFirst({ where: { vpsConfigId: null } });
        if (existing) {
          config = await prisma.systemConfig.update({
            where: { id: existing.id },
            data: { ...data, updatedAt: new Date() },
          });
        } else {
          config = await prisma.systemConfig.create({ data });
        }
      }
    } catch (dbErr: any) {
      // Table may not exist — return the submitted data as the effective config
      config = { ...data, id: 0, updatedAt: new Date() };
    }
    invalidateSystemConfigCache();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
