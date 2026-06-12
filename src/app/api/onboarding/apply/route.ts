import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptIfNeeded } from "@/lib/crypto";
import { invalidateSystemConfigCache } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

interface ApplyBody {
  vps: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    privateKey?: string;
    password?: string;
    authType?: string;
    isLocal?: boolean;
  };
  layout: {
    projectRoot?: string;
    caddySitesDir?: string;
    caddyFile?: string;
    nginxSitesDir?: string;
    nginxLogPath?: string;
    staticRoot?: string;
    sshDefaultCwd?: string;
    certDomain?: string;
    composeCommand?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { vps, layout }: ApplyBody = await req.json();

    await prisma.vpsConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    const created = await prisma.vpsConfig.create({
      data: {
        name: vps.name || "primary",
        host: vps.host || "local",
        port: Number(vps.port) || 22,
        username: vps.username || "root",
        privateKey: encryptIfNeeded(vps.privateKey || null) ?? null,
        password: encryptIfNeeded(vps.password || null) ?? null,
        authType: vps.authType || "key",
        isLocal: vps.isLocal || false,
        isActive: true,
      },
    });

    await prisma.systemConfig.upsert({
      where: { vpsConfigId: created.id },
      create: {
        vpsConfigId: created.id,
        projectRoot: layout.projectRoot,
        caddySitesDir: layout.caddySitesDir,
        caddyFile: layout.caddyFile,
        nginxSitesDir: layout.nginxSitesDir,
        nginxLogPath: layout.nginxLogPath,
        staticRoot: layout.staticRoot,
        sshDefaultCwd: layout.sshDefaultCwd,
        certDomain: layout.certDomain,
        composeCommand: layout.composeCommand,
      },
      update: {
        projectRoot: layout.projectRoot,
        caddySitesDir: layout.caddySitesDir,
        caddyFile: layout.caddyFile,
        nginxSitesDir: layout.nginxSitesDir,
        nginxLogPath: layout.nginxLogPath,
        staticRoot: layout.staticRoot,
        sshDefaultCwd: layout.sshDefaultCwd,
        certDomain: layout.certDomain,
        composeCommand: layout.composeCommand,
        updatedAt: new Date(),
      },
    });

    invalidateSystemConfigCache();
    return NextResponse.json({ success: true, vpsId: created.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
