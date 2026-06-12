import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { testConnection, type VpsConnection } from "@/lib/vps";
import { probeServerLayout } from "@/lib/server-probe";

interface DetectBody {
  host?: string;
  port?: number;
  username?: string;
  privateKey?: string;
  password?: string;
  authType?: string;
  isLocal?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body: DetectBody = await req.json();

    const test = await testConnection({
      host: body.host || "",
      port: Number(body.port) || 22,
      username: body.username || "root",
      privateKey: body.privateKey,
      password: body.password,
      authType: body.authType || "key",
      isLocal: body.isLocal || false,
    });

    if (!test.success) {
      return NextResponse.json({ error: test.message }, { status: 400 });
    }

    const conn: VpsConnection | null = body.isLocal
      ? null
      : {
          id: 0,
          host: body.host || "",
          port: Number(body.port) || 22,
          username: body.username || "root",
          isLocal: false,
          authType: body.authType || "key",
          privateKey: body.privateKey,
          password: body.password,
        };

    const layout = await probeServerLayout(conn);
    return NextResponse.json({ ...layout, connectionTest: test });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
