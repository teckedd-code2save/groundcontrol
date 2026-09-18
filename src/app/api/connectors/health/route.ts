import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, HttpError } from "@/lib/errors";
import { getConnectorHealth } from "@/lib/connector-health";

function parseConnector(value: unknown): "github" | "daytona" | "all" {
  return value === "github" || value === "daytona" ? value : "all";
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const connector = parseConnector(req.nextUrl.searchParams.get("connector"));
    const connectors = await getConnectorHealth({ connector });
    return NextResponse.json({ connectors });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") throw new HttpError("Admin access required", 403);
    const body = await req.json().catch(() => ({})) as {
      connector?: string;
      deep?: boolean;
    };
    const connector = parseConnector(body.connector);
    const connectors = await getConnectorHealth({
      connector,
      refresh: true,
      deepDaytona: connector === "daytona" || connector === "all" ? body.deep === true : false,
    });
    return NextResponse.json({ connectors });
  } catch (error) {
    return handleApiError(error);
  }
}
