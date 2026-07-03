import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTunnel, deleteTunnel, listTunnels } from "@/lib/cloudflare";
import { getCloudflaredContainerStatus, startCloudflaredConnector, stopCloudflaredConnector } from "@/lib/bootstrap";

function tunnelConnectorName(tunnelId: string): string {
  return `gc-cloudflared-${tunnelId.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24)}`;
}

function serializeTunnel(row: {
  id: number;
  tunnelId: string;
  name: string;
  tunnelSecret: string | null;
  connectorId: string | null;
  status: string;
  domains: string;
  configJson: string;
  cloudflareAccountId: number;
  createdAt: Date;
  updatedAt: Date;
}, connectorStatus?: string) {
  return {
    id: row.tunnelId,
    dbId: row.id,
    name: row.name,
    connectorId: row.connectorId,
    connectorStatus: connectorStatus || row.status,
    status: row.status,
    domains: row.domains ? row.domains.split(",").map((domain) => domain.trim()).filter(Boolean) : [],
    hasToken: Boolean(row.tunnelSecret),
    cloudflareAccountId: row.cloudflareAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const rows = await prisma.cloudflareTunnel.findMany({
      orderBy: { createdAt: "desc" },
    });

    const remote = await listTunnels().catch(() => []);
    const remoteById = new Map(remote.flatMap((tunnel) =>
      typeof tunnel.id === "string" ? [[tunnel.id, tunnel]] : []
    ));

    const tunnels = await Promise.all(rows.map(async (row) => {
      const connectorName = row.connectorId || tunnelConnectorName(row.tunnelId);
      const connector = await getCloudflaredContainerStatus(connectorName).catch(() => ({ running: false }));
      const remoteStatus = remoteById.get(row.tunnelId)?.status;
      const status = connector.running ? "active" : typeof remoteStatus === "string" ? remoteStatus : row.status;
      return serializeTunnel(row, status);
    }));

    return NextResponse.json({ tunnels });
  } catch {
    // Table might not exist yet — return empty
    return NextResponse.json({ tunnels: [] });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const { name, token: providedToken, tunnelId: providedTunnelId } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const activeAccount = await prisma.cloudflareAccount.findFirst({ where: { isActive: true } });
    if (!activeAccount) {
      return NextResponse.json({ error: "No active Cloudflare account configured" }, { status: 400 });
    }

    if (providedToken && !providedTunnelId) {
      return NextResponse.json({ error: "tunnelId is required when saving an existing tunnel token" }, { status: 400 });
    }

    const created = providedToken
      ? { tunnel: { id: String(providedTunnelId), name }, token: String(providedToken) }
      : await createTunnel(name);
    const tunnelId = typeof created.tunnel.id === "string" ? created.tunnel.id : "";
    const token = created.token || String(providedToken || "");
    if (!tunnelId || !token) {
      return NextResponse.json({ error: "Cloudflare did not return a tunnel id/token" }, { status: 502 });
    }

    const connectorId = tunnelConnectorName(tunnelId);
    const connector = await startCloudflaredConnector(connectorId, token);
    if (!connector.success) {
      return NextResponse.json({ error: connector.error || connector.output || "Failed to start cloudflared connector" }, { status: 500 });
    }

    const tunnel = await prisma.cloudflareTunnel.upsert({
      where: { tunnelId },
      create: {
        tunnelId,
        name,
        tunnelSecret: token,
        connectorId,
        status: "active",
        cloudflareAccountId: activeAccount.id,
        configJson: JSON.stringify(created.tunnel),
      },
      update: {
        name,
        tunnelSecret: token,
        connectorId,
        status: "active",
        cloudflareAccountId: activeAccount.id,
        configJson: JSON.stringify(created.tunnel),
      },
    });
    return NextResponse.json({ success: true, tunnel: serializeTunnel(tunnel, "active") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create tunnel" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const urlTunnelId = req.nextUrl.searchParams.get("tunnelId");
    let bodyTunnelId = "";
    if (!urlTunnelId) {
      const body = await req.json().catch(() => ({}));
      bodyTunnelId = String(body.tunnelId || body.id || "");
    }
    const tunnelId = String(urlTunnelId || bodyTunnelId).trim();
    if (!tunnelId) {
      return NextResponse.json({ error: "tunnelId is required" }, { status: 400 });
    }

    const row = await prisma.cloudflareTunnel.findFirst({
      where: /^\d+$/.test(tunnelId) ? { id: Number(tunnelId) } : { tunnelId },
    });
    if (row?.connectorId) {
      await stopCloudflaredConnector(row.connectorId).catch(() => undefined);
    }
    if (row?.tunnelId) {
      await deleteTunnel(row.tunnelId).catch(() => undefined);
      await prisma.cloudflareTunnel.delete({ where: { id: row.id } });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Could not delete tunnel" }, { status: 500 });
  }
}
