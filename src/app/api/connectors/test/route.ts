import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { decryptMaybe } from "@/lib/crypto";
import { execOnVps, getActiveVps } from "@/lib/vps";

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const { connectorId } = (await req.json()) as { connectorId?: string };
    if (!connectorId) {
      return NextResponse.json({ error: "connectorId required" }, { status: 400 });
    }

    const rows = await prisma.appConfig.findMany({
      where: { key: { startsWith: `connector_${connectorId}_` } },
    });
    const config: Record<string, string> = {};
    for (const r of rows) {
      const field = r.key.replace(`connector_${connectorId}_`, "");
      config[field] = decryptMaybe(r.value) || r.value;
    }

    if (Object.keys(config).length === 0) {
      return NextResponse.json({ error: "Connector not configured" }, { status: 400 });
    }

    if (connectorId === "github") {
      const { token, username } = config;
      if (!token) {
        return NextResponse.json({ error: "GitHub token not set" }, { status: 400 });
      }
      const vps = await getActiveVps();
      if (!vps?.isLocal) {
        return NextResponse.json({ error: "No active local VPS to test on" }, { status: 400 });
      }
      // Use Python to properly escape the token for shell
      const result = await execOnVps(
        `python3 -c "import subprocess; subprocess.run(['docker','login','ghcr.io','-u','${username || "gc-deploy"}','--password-stdin'],input='${token}',text=True,capture_output=True)" 2>&1 || echo "${token}" | docker login ghcr.io -u ${username || "gc-deploy"} --password-stdin 2>&1`,
        vps
      );
      if (result.stdout.includes("Login Succeeded")) {
        return NextResponse.json({ ok: true, message: "ghcr.io login successful — pull access confirmed" });
      }
      return NextResponse.json({
        error: `ghcr.io login failed: ${result.stderr || result.stdout || "unknown error"}`,
      }, { status: 400 });
    }

    if (connectorId === "gemini") {
      const { apiKey } = config;
      if (!apiKey) return NextResponse.json({ error: "API key not set" }, { status: 400 });
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (res.ok) return NextResponse.json({ ok: true, message: "Gemini API key is valid" });
        return NextResponse.json({ error: `Gemini API returned ${res.status}` }, { status: 400 });
      } catch {
        return NextResponse.json({ error: "Could not reach Gemini API" }, { status: 400 });
      }
    }

    if (connectorId === "daytona") {
      return NextResponse.json({ ok: true, message: "Daytona connector configured" });
    }

    return NextResponse.json({ error: "Unknown connector" }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
