import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { decryptMaybe } from "@/lib/crypto";

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
    if (!["gemini", "daytona"].includes(connectorId)) {
      return NextResponse.json({ error: "Unknown connector" }, { status: 400 });
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
