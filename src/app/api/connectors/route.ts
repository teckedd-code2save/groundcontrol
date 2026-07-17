import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { decryptMaybe, encrypt } from "@/lib/crypto";

const ALLOWED_CONNECTORS = ["github", "gemini", "daytona"];

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const rows = await prisma.appConfig.findMany({
      where: { key: { startsWith: "connector_" } },
    });
    const grouped: Record<string, Record<string, string>> = {};
    for (const r of rows) {
      const [, connectorId, field] = r.key.split("_", 3);
      if (!connectorId || !field) continue;
      if (!grouped[connectorId]) grouped[connectorId] = {};
      try {
        const parsed = JSON.parse(r.value);
        grouped[connectorId][field] = parsed[field] || r.value;
      } catch {
        grouped[connectorId][field] = decryptMaybe(r.value) || r.value;
      }
    }
    return NextResponse.json({
      connectors: ALLOWED_CONNECTORS.map((id) => ({
        id,
        configured: Object.keys(grouped[id] || {}).length > 0,
        config: grouped[id] || {},
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const { connectorId, config } = (await req.json()) as {
      connectorId?: string;
      config?: Record<string, string>;
    };
    if (!connectorId || !ALLOWED_CONNECTORS.includes(connectorId)) {
      return NextResponse.json({ error: "Invalid connector" }, { status: 400 });
    }
    if (!config || Object.keys(config).length === 0) {
      return NextResponse.json({ error: "No config provided" }, { status: 400 });
    }
    for (const [field, value] of Object.entries(config)) {
      const key = `connector_${connectorId}_${field}`;
      const encrypted = encrypt(value as string) || value;
      await prisma.appConfig.upsert({
        where: { key },
        create: { key, value: encrypted },
        update: { value: encrypted },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
