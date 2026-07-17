import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { decryptMaybe, encrypt } from "@/lib/crypto";

const ALLOWED_CONNECTORS = ["github", "gemini", "daytona"];

const CONNECTOR_META: Record<string, { name: string; description: string; purpose: string; provider: string; icon: string }> = {
  github: {
    name: "GitHub",
    description: "GitHub Container Registry pull access and image tag syncing.",
    purpose: "Authenticates docker pull from ghcr.io and enables automatic image tag updates via CI pipeline.",
    provider: "github.com",
    icon: "github",
  },
  gemini: {
    name: "Gemini",
    description: "Structured incident investigation and recovery planning.",
    purpose: "Analyses service evidence, forms hypotheses, and proposes least-disruptive recovery actions.",
    provider: "google",
    icon: "gemini",
  },
  daytona: {
    name: "Daytona",
    description: "Isolated sandbox for reproducing failures before applying fixes.",
    purpose: "Clones the exact commit, applies suspect changes, and validates fixes without touching production.",
    provider: "daytona",
    icon: "daytona",
  },
};

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
        ...CONNECTOR_META[id],
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
