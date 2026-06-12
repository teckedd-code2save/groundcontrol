import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveVps, execOnVps, shQuote } from "@/lib/vps";
import { listTunnels, createTunnel, deleteTunnel, getActiveCloudflareAccount } from "@/lib/cloudflare";

interface TunnelWithDb extends Record<string, unknown> {
  id: string;
  name: string;
}

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const account = await getActiveCloudflareAccount();
    if (!account) return NextResponse.json({ error: "No active Cloudflare account" }, { status: 400 });

    const [cfTunnels, dbTunnels] = await Promise.all([
      listTunnels(account),
      prisma.cloudflareTunnel.findMany({ where: { account: { id: account.id } } }),
    ]);

    const dbById = new Map(dbTunnels.map((t) => [t.tunnelId, t]));
    const merged = cfTunnels.map((t) => {
      const tunnel = t as TunnelWithDb;
      const db = dbById.get(tunnel.id);
      return {
        ...tunnel,
        dbId: db?.id,
        connectorStatus: db?.status || "inactive",
        connectorId: db?.connectorId || null,
      };
    });

    return NextResponse.json({ success: true, tunnels: merged });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name || "");
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const account = await getActiveCloudflareAccount();
    if (!account) return NextResponse.json({ error: "No active Cloudflare account" }, { status: 400 });
    if (!account.accountId) return NextResponse.json({ error: "Account ID required" }, { status: 400 });

    const { tunnel, token } = await createTunnel(name, account);
    const tunnelId = String(tunnel.id);
    const tunnelSecret = token || "";

    const vps = await getActiveVps();
    if (!vps) {
      return NextResponse.json({ error: "No active VPS configured" }, { status: 400 });
    }

    const credsPath = `/tmp/gc-cloudflared-${tunnelId}.json`;
    const credsJson = JSON.stringify({
      AccountTag: account.accountId,
      TunnelID: tunnelId,
      TunnelSecret: tunnelSecret,
    });
    const writeCreds = await execOnVps(
      `cat > ${shQuote(credsPath)} << 'EOF'\n${credsJson}\nEOF`,
      vps
    );
    if (writeCreds.code !== 0) {
      return NextResponse.json({ error: `Failed to write credentials: ${writeCreds.stderr}` }, { status: 500 });
    }

    const containerName = `gc-tunnel-${tunnelId}`;
    const runResult = await execOnVps(
      `docker run --rm -d --name ${shQuote(containerName)} -v ${shQuote(credsPath)}:/etc/cloudflared/creds.json cloudflare/cloudflared:latest tunnel --no-autoupdate run --credentials-file /etc/cloudflared/creds.json 2>&1`,
      vps
    );

    const connectorId = runResult.stdout.trim();
    const running = runResult.code === 0 && connectorId.length > 0;

    const dbTunnel = await prisma.cloudflareTunnel.create({
      data: {
        tunnelId,
        name,
        tunnelSecret: tunnelSecret ? Buffer.from(tunnelSecret).toString("base64") : null,
        connectorId: running ? connectorId.slice(0, 12) : null,
        status: running ? "active" : "error",
        account: { connect: { id: account.id } },
      },
    });

    return NextResponse.json({
      success: true,
      tunnel: dbTunnel,
      connector: { running, output: runResult.stdout, error: runResult.stderr },
    });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const tunnelId = searchParams.get("tunnelId");
    if (!tunnelId) return NextResponse.json({ error: "tunnelId required" }, { status: 400 });

    const account = await getActiveCloudflareAccount();
    if (!account) return NextResponse.json({ error: "No active Cloudflare account" }, { status: 400 });

    const vps = await getActiveVps();
    if (vps) {
      const containerName = `gc-tunnel-${tunnelId}`;
      await execOnVps(`docker stop ${shQuote(containerName)} 2>/dev/null || true`, vps);
      await execOnVps(`docker rm ${shQuote(containerName)} 2>/dev/null || true`, vps);
    }

    await deleteTunnel(tunnelId, account);
    await prisma.cloudflareTunnel.deleteMany({ where: { tunnelId } });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
